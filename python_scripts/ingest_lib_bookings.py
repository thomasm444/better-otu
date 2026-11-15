"""Scrape Ontario Tech library study room bookings and upsert into public.library_study_rooms."""

from __future__ import annotations

import re
import time
from html.parser import HTMLParser

import requests

from db import batches, get_supabase, utc_now_iso

LIBRARY_CALENDAR_URL = "https://apps.library.dc-ot.ca/OTrooms/calendar.aspx"
REQUEST_TIMEOUT_SECONDS = 20
DEFAULT_DELAY_SECONDS = 0.5

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) "
        "Gecko/20100101 Firefox/159.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
    "Content-Type": "application/x-www-form-urlencoded",
    "Origin": "https://apps.library.dc-ot.ca",
    "Referer": LIBRARY_CALENDAR_URL,
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


class LibraryTableParser(HTMLParser):
    """HTML parser for the ASP.NET library study room calendar table."""

    def __init__(self) -> None:
        super().__init__()
        self.in_table = False
        self.in_cell = False
        self.in_date_label = False
        self.selected_date: str | None = None
        self.cell_tag: str | None = None
        self.cell_attrs: dict[str, str] = {}
        self.cell_text: list[str] = []
        self.current_row: list[dict] = []
        self.rows: list[list[dict]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k: (v or "") for k, v in attrs}
        if attrs_dict.get("id") == "ContentPlaceHolder1_LabelDate":
            self.in_date_label = True
        if tag == "table" and "ContentPlaceHolder1_Table1" in attrs_dict.get("id", ""):
            self.in_table = True
        if not self.in_table:
            return
        if tag == "tr":
            self.current_row = []
        elif tag in ("th", "td"):
            self.in_cell = True
            self.cell_tag = tag
            self.cell_attrs = attrs_dict
            self.cell_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "span" and self.in_date_label:
            self.in_date_label = False
        if not self.in_table:
            return
        if tag in ("th", "td"):
            self.in_cell = False
            raw_text = " ".join("".join(self.cell_text).split())
            self.current_row.append(
                {
                    "tag": self.cell_tag,
                    "attrs": self.cell_attrs,
                    "text": raw_text,
                }
            )
        elif tag == "tr":
            if self.current_row:
                self.rows.append(self.current_row)
        elif tag == "table":
            self.in_table = False

    def handle_data(self, data: str) -> None:
        if self.in_date_label and not self.selected_date:
            self.selected_date = data.strip()
        if self.in_cell:
            self.cell_text.append(data)


def parse_time_to_minutes(time_str: str) -> int | None:
    cleaned = time_str.replace("\xa0", " ").strip()
    match = re.search(r"(\d+):(\d+)\s*(AM|PM)", cleaned, re.IGNORECASE)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    ampm = match.group(3).upper()
    if ampm == "PM" and hour != 12:
        hour += 12
    elif ampm == "AM" and hour == 12:
        hour = 0
    return hour * 60 + minute


def minutes_to_time(minutes: int) -> str:
    hour = minutes // 60
    minute = minutes % 60
    ampm = "AM" if hour < 12 else "PM"
    h12 = hour % 12 or 12
    return f"{h12}:{minute:02d} {ampm}"


def determine_cell_status(text: str) -> str:
    cleaned = text.strip()
    if cleaned.lower() == "open":
        return "Open"
    if cleaned in ("-", ""):
        return "Closed"
    return "Booked"


def parse_library_schedule(html_content: str) -> list[dict]:
    """Parse one date's ASP.NET library room table, preserving rowspan/colspan alignment."""
    parser = LibraryTableParser()
    parser.feed(html_content)

    date_str = parser.selected_date
    if not date_str:
        match = re.search(
            r'id=["\']ContentPlaceHolder1_LabelDate["\'][^>]*>([^<]+)</span>',
            html_content,
        )
        if match:
            date_str = match.group(1).strip()
    if date_str:
        date_str = re.sub(r"\s*\([^)]*\)", "", date_str).strip()

    if not parser.rows:
        return []

    header_row = parser.rows[0]
    rooms: list[dict] = []
    for cell in header_row[1:]:
        room_name = cell["text"]
        title_attr = cell["attrs"].get("title", "")
        min_cap = None
        max_cap = None
        cap_match = re.search(r"Min\s*(\d+).*?Max\s*(\d+)", title_attr, re.IGNORECASE)
        if cap_match:
            min_cap = int(cap_match.group(1))
            max_cap = int(cap_match.group(2))
        rooms.append(
            {
                "roomId": room_name,
                "minCapacity": min_cap,
                "maxCapacity": max_cap,
            }
        )

    num_rooms = len(rooms)
    data_rows = parser.rows[1:]
    num_data_rows = len(data_rows)
    row_times = [parse_time_to_minutes(row[0]["text"]) for row in data_rows]

    grid: list[list[dict | None]] = [[None] * num_rooms for _ in range(num_data_rows)]
    room_schedules: dict[str, list[dict]] = {r["roomId"]: [] for r in rooms}

    for r_idx, row in enumerate(data_rows):
        cur_min = row_times[r_idx]
        data_cells = row[1:]
        cell_ptr = 0

        for c_idx in range(num_rooms):
            if grid[r_idx][c_idx] is not None:
                continue
            if cell_ptr >= len(data_cells):
                continue

            cell = data_cells[cell_ptr]
            cell_ptr += 1

            rowspan = int(cell["attrs"].get("rowspan", 1))
            colspan = int(cell["attrs"].get("colspan", 1))
            text = cell["text"]
            status = determine_cell_status(text)
            duration_min = 30 * rowspan
            start_min = cur_min
            end_min = start_min + duration_min if start_min is not None else None

            booking_info = {
                "roomId": rooms[c_idx]["roomId"],
                "date": date_str,
                "title": text if status == "Booked" else status,
                "status": status,
                "start": minutes_to_time(start_min) if start_min is not None else None,
                "end": minutes_to_time(end_min) if end_min is not None else None,
                "startMinutes": start_min,
                "endMinutes": end_min,
                "durationMinutes": duration_min,
            }

            for dr in range(rowspan):
                for dc in range(colspan):
                    if r_idx + dr < num_data_rows and c_idx + dc < num_rooms:
                        grid[r_idx + dr][c_idx + dc] = booking_info

            if status == "Booked":
                room_schedules[rooms[c_idx]["roomId"]].append(booking_info)

    return [
        {
            "roomId": r["roomId"],
            "minCapacity": r["minCapacity"],
            "maxCapacity": r["maxCapacity"],
            "bookings": room_schedules[r["roomId"]],
        }
        for r in rooms
    ]


def extract_aspnet_state(html_text: str) -> dict[str, str]:
    state: dict[str, str] = {}
    for key in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"):
        match = re.search(
            r'id=["\']' + key + r'["\'][^>]*value=["\']([^"\']*)["\']', html_text
        ) or re.search(
            r'name=["\']' + key + r'["\'][^>]*value=["\']([^"\']*)["\']', html_text
        )
        if match:
            state[key] = match.group(1)
    return state


def extract_available_dates(html_text: str) -> list[tuple[int, str]]:
    pattern = (
        r'id=["\']ContentPlaceHolder1_RadioButtonListDateSelection_(\d+)["\']'
        r'[^>]*value=["\']([^"\']+)["\']'
    )
    seen: set[int] = set()
    dates: list[tuple[int, str]] = []
    for idx_str, val in sorted(re.findall(pattern, html_text), key=lambda x: int(x[0])):
        idx = int(idx_str)
        if idx not in seen:
            seen.add(idx)
            dates.append((idx, val))
    return dates


def scrape_library_rooms(delay_sec: float = DEFAULT_DELAY_SECONDS) -> dict[str, dict]:
    """Crawl all available dates on the library portal and aggregate bookings by room_id."""
    session = requests.Session()
    session.headers.update(HEADERS)

    resp = session.get(LIBRARY_CALENDAR_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    resp.raise_for_status()
    current_state = extract_aspnet_state(resp.text)

    if "ContentPlaceHolder1_ButtonContinue" in resp.text:
        resp = session.post(
            LIBRARY_CALENDAR_URL,
            data={
                "__VIEWSTATE": current_state.get("__VIEWSTATE", ""),
                "__VIEWSTATEGENERATOR": current_state.get(
                    "__VIEWSTATEGENERATOR", "B1751EB6"
                ),
                "__EVENTVALIDATION": current_state.get("__EVENTVALIDATION", ""),
                "ctl00$ContentPlaceHolder1$ButtonContinue": "Continue",
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        current_state = extract_aspnet_state(resp.text)

    date_options = extract_available_dates(resp.text)
    if not date_options:
        raise RuntimeError("Could not find date options in library calendar page.")

    by_room: dict[str, dict] = {}
    for idx, _ in date_options:
        resp = session.post(
            LIBRARY_CALENDAR_URL,
            data={
                "__EVENTTARGET": f"ctl00$ContentPlaceHolder1$RadioButtonListDateSelection${idx}",
                "__EVENTARGUMENT": "",
                "__LASTFOCUS": "",
                "__VIEWSTATE": current_state.get("__VIEWSTATE", ""),
                "__VIEWSTATEGENERATOR": current_state.get(
                    "__VIEWSTATEGENERATOR", "B1751EB6"
                ),
                "__EVENTVALIDATION": current_state.get("__EVENTVALIDATION", ""),
                "ctl00$ContentPlaceHolder1$RadioButtonListDateSelection": _,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        current_state = extract_aspnet_state(resp.text)

        for room in parse_library_schedule(resp.text):
            rid = room["roomId"]
            entry = by_room.setdefault(
                rid,
                {
                    "room_id": rid,
                    "min_capacity": room["minCapacity"],
                    "max_capacity": room["maxCapacity"],
                    "bookings": [],
                },
            )
            entry["bookings"].extend(room["bookings"])

        if delay_sec > 0:
            time.sleep(delay_sec)

    return by_room


def main() -> int:
    print("Scraping Ontario Tech library study rooms...")
    by_room = scrape_library_rooms()
    now_iso = utc_now_iso()

    rows = [{**room, "updated_at": now_iso} for room in by_room.values()]
    total_bookings = sum(len(r["bookings"]) for r in rows)
    print(f"Scraped {len(rows)} rooms ({total_bookings} bookings).")

    supabase = get_supabase()
    upserted = 0
    for batch in batches(rows):
        supabase.table("library_study_rooms").upsert(
            batch, on_conflict="room_id"
        ).execute()
        upserted += len(batch)

    print(f"library_study_rooms: {upserted} upserted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
