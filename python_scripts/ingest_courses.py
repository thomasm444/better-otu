"""Scrape Banner course sections for target term(s) and ingest directly into Supabase."""

from __future__ import annotations

import argparse
import html
import os
import re
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests

from banner_auth import BannerSession, TermSession
from db import batches, get_supabase, load_env, utc_now_iso

TORONTO_TZ = ZoneInfo("America/Toronto")
DAYTIME_HOURS = range(6, 24)  # 6:00 AM - 11:59 PM

# Optional per-term registration window overrides:
#   "preview_start"  -> hourly 6am-12am
#   "reg_open"       -> every 15m daytime until reg_open_end
#   "reg_open_end"   -> 1 week after last group; daily afterwards until pre_class_start
#   "pre_class_start"-> 1 week before classes; every 15m daytime until reg_close
#   "reg_close"      -> after this, weekly until semester ends
# Dates not listed fall back to daily updates for the next term.
TERM_WINDOWS: dict[str, dict[str, date]] = {
    "202701": {
        "preview_start": date(2026, 11, 2),
        "reg_open": date(2026, 11, 16),
        "reg_open_end": date(2026, 11, 27),
        "pre_class_start": date(2027, 1, 4),
        "reg_close": date(2027, 1, 22),
    },
}

SEARCH_URL = "https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/searchResults/searchResults"
MAX_PAGE_SIZE = 500
REQUEST_DELAY_SECONDS = 0.25
REQUEST_TIMEOUT_SECONDS = 60

_BANNER_ERROR_RE = re.compile(r'errorMessage"\s+content="([^"]*)"')
_TERM_CODE_RE = re.compile(r"^\d{6}$")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:155.0) "
        "Gecko/20100101 Firefox/155.0"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/classSearch/classSearch",
    "Connection": "keep-alive",
}

FIELD_MAP = {
    "termDesc": "term_desc",
    "partOfTerm": "part_of_term",
    "courseNumber": "course_number",
    "courseDisplay": "course_display",
    "subject": "subject",
    "subjectDescription": "subject_description",
    "sequenceNumber": "sequence_number",
    "campusDescription": "campus_description",
    "scheduleTypeDescription": "schedule_type_description",
    "courseTitle": "course_title",
    "creditHours": "credit_hours",
    "maximumEnrollment": "maximum_enrollment",
    "enrollment": "enrollment",
    "seatsAvailable": "seats_available",
    "waitCapacity": "wait_capacity",
    "waitCount": "wait_count",
    "waitAvailable": "wait_available",
    "crossList": "cross_list",
    "crossListCapacity": "cross_list_capacity",
    "crossListCount": "cross_list_count",
    "crossListAvailable": "cross_list_available",
    "creditHourHigh": "credit_hour_high",
    "creditHourLow": "credit_hour_low",
    "creditHourIndicator": "credit_hour_indicator",
    "openSection": "open_section",
    "linkIdentifier": "link_identifier",
    "isSectionLinked": "is_section_linked",
    "subjectCourse": "subject_course",
    "instructionalMethod": "instructional_method",
    "instructionalMethodDescription": "instructional_method_description",
}

ROOM_REMAP = {
    "CC2127": "CCB2127",
    "CC2322": "CCB2322",
    "CC2323": "CCB2323",
    "CC2324": "CCB2324",
    "CC2402": "CCB2402WS",
    "CC2403": "CCB2403WS",
    "CC2404": "CCB2404WS",
    "CC2405": "CCB2405WS",
    "CC2406": "CCB2406WS",
    "CC2407": "CCB2407WS",
    "CC3305": "CCB3305",
    "CC3320": "CCB3320",
    "CC3322A": "CCB3322A",
    "1020": "SIR1020",
    "1303": "SIR1303",
    "1311": "SIR1311",
    "2010A": "SIR2010A",
    "2010B": "SIR2010B",
    "2020A": "SIR2020A",
    "2020B": "SIR2020B",
}


def normalize_course_room(room: str | None, building: str | None = None) -> str | None:
    if not room:
        return room
    r = room.strip()
    if not r:
        return r
    if r in ROOM_REMAP:
        return ROOM_REMAP[r]
    b = (building or "").strip()
    if r.startswith("UA") and r[2:].isalnum():
        return "SCI" + r[2:]
    if r.startswith("UB") and r[2:].isalnum():
        return "BIT" + r[2:]
    if r.startswith("DTA") and r[3:].isalnum():
        return "CHA" + r[3:]
    if r in ("UP1501", "UP1502"):
        return "PAV" + r[2:]
    if b == "SHA" and r.isdigit():
        return f"SHA{int(r):03d}"
    if b in ("SIR", "SIRC") and r[0].isdigit():
        return f"SIR{r}"
    return r


def _request_page(
    http: requests.Session, session: TermSession, offset: int, page_size: int
) -> dict:
    resp = http.get(
        SEARCH_URL,
        params={
            "txt_term": session.term_code,
            "startDatepicker": "",
            "endDatepicker": "",
            "uniqueSessionId": session.unique_session_id,
            "pageOffset": offset,
            "pageMaxSize": page_size,
            "sortColumn": "subjectDescription",
            "sortDirection": "asc",
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    if resp.status_code != 200:
        msg = _BANNER_ERROR_RE.search(resp.text or "")
        hint = f" ({msg.group(1)})" if msg else ""
        raise RuntimeError(f"searchResults HTTP {resp.status_code} at offset {offset}{hint}")

    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(f"searchResults failed at offset {offset}: {payload!r}")
    return payload


def fetch_term_sections(
    session: TermSession, page_size: int = MAX_PAGE_SIZE, delay: float = REQUEST_DELAY_SECONDS
) -> list[dict]:
    if not session.term_code or not session.unique_session_id:
        raise RuntimeError("Incomplete Banner session (missing term_code or unique_session_id).")

    with requests.Session() as http:
        http.headers.update({**HEADERS, **session.headers})
        for cookie in session.cookies:
            http.cookies.set(
                cookie["name"],
                cookie["value"],
                domain=cookie.get("domain") or "ssp.mycampus.ca",
                path=cookie.get("path") or "/",
            )

        payload = _request_page(http, session, 0, page_size)
        total_count = int(payload.get("totalCount") or 0)
        sections = list(payload.get("data") or [])

        offset = page_size
        while offset < total_count:
            time.sleep(delay)
            batch = _request_page(http, session, offset, page_size).get("data") or []
            if not batch:
                break
            sections.extend(batch)
            offset += page_size

    return sections


def unescape_row(row: dict) -> dict:
    return {
        k: html.unescape(v) if isinstance(v, str) else v
        for k, v in row.items()
    }


def to_time(value: str | None) -> str | None:
    if not value:
        return None
    return f"{value[:2]}:{value[2:]}:00"


def to_date(value: str | None) -> str | None:
    if not value:
        return None
    return datetime.strptime(value, "%m/%d/%Y").date().isoformat()


def to_course_row(course: dict, now_iso: str) -> dict:
    row = {
        "id": course["id"],
        "term": course["term"],
        "crn": course["courseReferenceNumber"],
        "updated_at": now_iso,
    }
    for src, dst in FIELD_MAP.items():
        row[dst] = course.get(src)
    return unescape_row(row)


def to_faculty_rows(course: dict):
    for f in course.get("faculty") or []:
        yield unescape_row(
            {
                "course_id": course["id"],
                "term": f.get("term") or course["term"],
                "banner_id": f["bannerId"],
                "display_name": f.get("displayName"),
                "email_address": f.get("emailAddress"),
                "category": f.get("category"),
                "primary_indicator": bool(f.get("primaryIndicator")),
            }
        )


def to_meeting_rows(course: dict):
    for meeting in course.get("meetingsFaculty") or []:
        mt = meeting.get("meetingTime") or {}
        raw_room = mt.get("room")
        norm_room = (
            normalize_course_room(raw_room, mt.get("building"))
            if isinstance(raw_room, str) and raw_room.strip()
            else raw_room
        )
        yield unescape_row(
            {
                "course_id": course["id"],
                "term": mt.get("term") or course["term"],
                "category": mt.get("category") or meeting.get("category"),
                "meeting_type": mt.get("meetingType"),
                "meeting_type_description": mt.get("meetingTypeDescription"),
                "meeting_schedule_type": mt.get("meetingScheduleType"),
                "begin_time": to_time(mt.get("beginTime")),
                "end_time": to_time(mt.get("endTime")),
                "start_date": to_date(mt.get("startDate")),
                "end_date": to_date(mt.get("endDate")),
                "building": mt.get("building"),
                "building_description": mt.get("buildingDescription"),
                "room": norm_room,
                "campus": mt.get("campus"),
                "campus_description": mt.get("campusDescription"),
                "credit_hour_session": mt.get("creditHourSession"),
                "hours_week": mt.get("hoursWeek"),
                "monday": bool(mt.get("monday")),
                "tuesday": bool(mt.get("tuesday")),
                "wednesday": bool(mt.get("wednesday")),
                "thursday": bool(mt.get("thursday")),
                "friday": bool(mt.get("friday")),
                "saturday": bool(mt.get("saturday")),
                "sunday": bool(mt.get("sunday")),
            }
        )


def dedupe_faculty_rows(rows: list[dict]) -> list[dict]:
    by_key: dict[tuple, dict] = {}
    for row in rows:
        key = (row["course_id"], row["banner_id"], row["display_name"])
        existing = by_key.get(key)
        if existing is None or (row["primary_indicator"] and not existing["primary_indicator"]):
            by_key[key] = row
    return list(by_key.values())


def ingest_term_into_supabase(supabase, sections: list[dict]) -> None:
    deduped = list({c["id"]: c for c in sections if c.get("id") is not None}.values())
    if not deduped:
        print("  No sections to ingest.")
        return

    now_iso = utc_now_iso()
    course_rows = [to_course_row(c, now_iso) for c in deduped]
    faculty_rows = dedupe_faculty_rows([r for c in deduped for r in to_faculty_rows(c)])
    meeting_rows = [r for c in deduped for r in to_meeting_rows(c)]
    terms = sorted({c["term"] for c in deduped})

    for term in terms:
        for table in ("course_faculty", "course_meetings"):
            supabase.table(table).delete().eq("term", term).execute()

    for batch in batches(course_rows):
        supabase.table("courses").upsert(batch, on_conflict="id").execute()
    print(f"  courses: {len(course_rows)} upserted")

    for table, rows in (("course_faculty", faculty_rows), ("course_meetings", meeting_rows)):
        done = 0
        for batch in batches(rows):
            supabase.table(table).insert(batch).execute()
            done += len(batch)
        print(f"  {table}: {done} inserted")


def current_and_next_term(now: datetime | None = None) -> tuple[str, str]:
    """Return (current_term_code, next_term_code) from the Toronto calendar date."""
    now = now or datetime.now(TORONTO_TZ)
    if 1 <= now.month <= 4:
        return f"{now.year}01", f"{now.year}05"
    if 5 <= now.month <= 8:
        return f"{now.year}05", f"{now.year}09"
    return f"{now.year}09", f"{now.year + 1}01"


def next_term_cadence(term_code: str, today: date) -> str:
    """Return cadence for the upcoming term: '15m', 'hourly', 'daily', or 'weekly'."""
    win = TERM_WINDOWS.get(term_code)
    if not win:
        return "daily"
    if today < win["preview_start"]:
        return "daily"
    if today < win["reg_open"]:
        return "hourly"
    if today <= win["reg_open_end"]:
        return "15m"
    if today < win["pre_class_start"]:
        return "daily"
    if today <= win["reg_close"]:
        return "15m"
    return "weekly"


def is_cadence_due(cadence: str, now: datetime) -> bool:
    """Check whether *cadence* should run at *now*, allowing for EST/EDT shift & GH Actions delay."""
    if cadence == "15m":
        return now.hour in DAYTIME_HOURS
    if cadence == "hourly":
        return now.hour in DAYTIME_HOURS and now.minute < 50
    if cadence == "daily":
        return now.hour in (6, 7)
    if cadence == "weekly":
        return now.weekday() == 0 and now.hour in (6, 7)
    return True


def resolve_due_terms(cli_terms: list[str], force: bool, now: datetime | None = None) -> list[str]:
    if cli_terms:
        return cli_terms
    now = now or datetime.now(TORONTO_TZ)
    cur_term, nxt_term = current_and_next_term(now)
    if force:
        return [cur_term, nxt_term]

    due: list[str] = []
    if is_cadence_due("weekly", now):
        due.append(cur_term)
    nxt_cadence = next_term_cadence(nxt_term, now.date())
    if is_cadence_due(nxt_cadence, now):
        due.append(nxt_term)
    return due


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(
        description="Scrape Banner course sections for due term(s) and ingest into Supabase."
    )
    parser.add_argument(
        "terms",
        nargs="*",
        help="Optional explicit term codes or labels (e.g. 202609 202701).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore schedule cadence and scrape both current and next term immediately.",
    )
    args = parser.parse_args(argv)

    target_terms = resolve_due_terms(args.terms, force=args.force)
    if not target_terms:
        cur_term, nxt_term = current_and_next_term()
        print(f"No terms due at this time (current={cur_term} weekly, next={nxt_term}).")
        return 0

    supabase = get_supabase()
    print("Signing in to Banner...")
    with BannerSession() as banner:
        print(f"Target terms: {', '.join(target_terms)}")

        for term in target_terms:
            print(f"Scraping {term}...")
            for attempt in range(2):
                try:
                    session = banner.open_term_session(term)
                    sections = fetch_term_sections(session)
                    print(f"  Downloaded {len(sections)} sections for {session.term_code}")
                    ingest_term_into_supabase(supabase, sections)
                    break
                except Exception as exc:
                    if attempt == 0:
                        print(f"  Retrying {term} after error: {exc}")
                        banner.reauthenticate()
                        continue
                    raise

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
