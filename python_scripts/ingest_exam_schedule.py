"""Scrape Ontario Tech exam schedules and ingest into public.exam_schedules."""

from __future__ import annotations

import argparse
from datetime import datetime
from zoneinfo import ZoneInfo

import requests

from db import batches, get_supabase, utc_now_iso

EXAM_API_URL = "https://api.ontariotechu.ca/academic-schedule-exams/search/term_id/{term_id}"
REQUEST_TIMEOUT_SECONDS = 30
TORONTO_TZ = ZoneInfo("America/Toronto")

# Anchor: Fall 2026 (202609) is term_id 53, Winter 2027 (202701) is 54, Summer 2027 (202705) is 55.
ANCHOR_YEAR = 2026
ANCHOR_SEASON_IDX = 2  # 0=Winter (01), 1=Summer (05), 2=Fall (09)
ANCHOR_TERM_ID = 53


def current_exam_term_id(now: datetime | None = None) -> int:
    """Compute the Ontario Tech exam API term_id for the current semester."""
    now = now or datetime.now(TORONTO_TZ)
    if 1 <= now.month <= 4:
        season_idx = 0
    elif 5 <= now.month <= 8:
        season_idx = 1
    else:
        season_idx = 2
    return ANCHOR_TERM_ID + (now.year - ANCHOR_YEAR) * 3 + (season_idx - ANCHOR_SEASON_IDX)


def fetch_exam_schedule(term_id: int) -> list[dict]:
    """Fetch exam schedule rows from the Ontario Tech API for *term_id*."""
    url = EXAM_API_URL.format(term_id=term_id)
    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("data")
    if not isinstance(rows, list):
        raise RuntimeError(f"Unexpected exam API payload for term_id={term_id}: {payload!r}")
    return rows


def to_exam_row(item: dict, now_iso: str) -> dict:
    """Map an Ontario Tech exam API object to a public.exam_schedules row."""
    crn = item.get("crn")
    return {
        "id": item["id"],
        "term_id": item["term_id"],
        "term_season": item.get("term_season"),
        "term_year": item.get("term_year"),
        "subject_id": item.get("subject_id"),
        "subject_code": item.get("subject_code"),
        "subject_name": item.get("subject_name"),
        "course_code": item.get("course_code"),
        "title": item.get("title"),
        "crn": str(crn) if crn is not None else None,
        "instructor": item.get("instructor"),
        "exam_date": item.get("date") or None,
        "exam_time": item.get("time") or None,
        "duration": item.get("duration") or None,
        "room_id": item.get("room_id"),
        "room": item.get("room"),
        "location": item.get("location"),
        "surname": item.get("surname"),
        "seating": item.get("seating"),
        "amendment": item.get("amendment"),
        "notes": item.get("notes"),
        "updated_at": now_iso,
    }


def main(argv: list[str] | None = None) -> int:
    default_term = current_exam_term_id()

    parser = argparse.ArgumentParser(description="Ingest Ontario Tech exam schedules into Supabase.")
    parser.add_argument(
        "--term",
        type=int,
        default=default_term,
        help=f"Ontario Tech exam term_id (auto-computed default: {default_term})",
    )
    args = parser.parse_args(argv)

    print(f"Fetching exam schedule for term_id={args.term}...")
    raw_rows = fetch_exam_schedule(args.term)
    now_iso = utc_now_iso()

    by_id = {item["id"]: to_exam_row(item, now_iso) for item in raw_rows if item.get("id") is not None}
    rows = list(by_id.values())
    print(f"Fetched {len(rows)} exam rows.")

    supabase = get_supabase()
    supabase.table("exam_schedules").delete().eq("term_id", args.term).execute()

    inserted = 0
    for batch in batches(rows):
        supabase.table("exam_schedules").insert(batch).execute()
        inserted += len(batch)

    print(f"exam_schedules: replaced term_id={args.term} with {inserted} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
