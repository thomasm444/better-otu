"""Scrape Infosilem Campus Portal room details & reservations and ingest into Supabase."""

from __future__ import annotations

import argparse
import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests

from db import LOCAL_DIR, SCRIPTS_DIR, batches, get_supabase, load_env, utc_now_iso

TENANT_ID = "51cca0e1-2d5a-4d1b-aa9a-ddaaa78aeec2"
CLIENT_ID = "6bf11228-a988-4dd2-b890-3d67542bb765"
REDIRECT_URI = "https://campusportal.ca.infosilem.com/ontariotech/p/"

AUTHORIZE_URL = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize"
AUTH_FROM_CODE_URL = "https://campusportal.ca.infosilem.com/ontariotech/api/session/authFromCode"
SESSION_TOKEN_URL = "https://campusportal.ca.infosilem.com/ontariotech/api/session/token"

SEARCH_ROOMS_URL = "https://campusportal.ca.infosilem.com/ontariotech/syncApi/search/searchRooms"
ROOM_CALENDAR_URL = "https://campusportal.ca.infosilem.com/ontariotech/syncApi/calendar/roomCalendar"

DEFAULT_SEARCH_PAYLOAD: dict[str, Any] = {
    "locationId": "00000000-0000-0000-0000-000000000000",
    "roomTypes": [],
    "floorLevels": [],
    "pavilions": [],
    "characteristics": [],
    "configTypes": [],
    "minCapacity": 0,
    "minArea": 0,
    "requestTypeId": "00000000-0000-0000-0000-000000000000",
}
DEFAULT_CALENDAR_RANGE = (0, 9999999999)
MIN_AUTH_ROOM_COUNT = 100
REQUEST_TIMEOUT_SECONDS = 30

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) "
    "Gecko/20100101 Firefox/159.0"
)
_CODE_RE = re.compile(r"[?&]code=([^&\"'\s#]+)")

LOCAL_SESSION_CANDIDATES = (
    SCRIPTS_DIR / ".infosilem_session.json",
    LOCAL_DIR / "map" / ".infosilem_session.json",
)


def _load_cookies() -> dict[str, str]:
    raw_env = os.environ.get("INFOSILEM_COOKIES_JSON", "").strip()
    if raw_env:
        parsed = json.loads(raw_env)
        if isinstance(parsed, dict):
            # Support pasting either the raw cookies dict or full .infosilem_session.json
            cookies = parsed.get("cookies") if "cookies" in parsed else parsed
            if isinstance(cookies, dict):
                return {str(k): str(v) for k, v in cookies.items() if v}

    for path in LOCAL_SESSION_CANDIDATES:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf8"))
                cookies = data.get("cookies")
                if isinstance(cookies, dict) and cookies:
                    return {str(k): str(v) for k, v in cookies.items() if v}
            except (OSError, ValueError):
                pass
    return {}


def _save_local_session(session_jwt: str, portal_jwt: str, cookies: dict[str, str]) -> None:
    if os.environ.get("CI"):
        return
    target = SCRIPTS_DIR / ".infosilem_session.json"
    target.write_text(
        json.dumps(
            {
                "session_jwt": session_jwt,
                "portal_jwt": portal_jwt,
                "cookies": cookies,
            },
            indent=2,
        ),
        encoding="utf8",
    )


def _extract_code_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    for part in (parsed.query, parsed.fragment):
        code = parse_qs(part).get("code", [None])[0]
        if code:
            return code
    return None


def _exchange_code_for_tokens(http: requests.Session, code: str) -> tuple[str, str]:
    common_headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        "Content-Language": "en",
        "Origin": "https://campusportal.ca.infosilem.com",
        "Referer": REDIRECT_URI,
    }
    auth_resp = http.post(
        AUTH_FROM_CODE_URL,
        json={"code": code},
        headers={**common_headers, "Content-Type": "application/json"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    auth_resp.raise_for_status()
    auth_payload = auth_resp.json()
    session_jwt = (auth_payload.get("response") or {}).get("jwt")
    if not auth_payload.get("success") or not session_jwt:
        raise RuntimeError(f"authFromCode failed: {auth_payload!r}")

    token_resp = http.get(
        SESSION_TOKEN_URL,
        headers={**common_headers, "Authorization": f"Bearer {session_jwt}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    token_resp.raise_for_status()
    token_payload = token_resp.json()
    portal_jwt = token_payload.get("response")
    if not token_payload.get("success") or not portal_jwt:
        raise RuntimeError(f"session/token failed: {token_payload!r}")

    return session_jwt, portal_jwt


def _try_silent_oauth(cookies: dict[str, str]) -> tuple[str, str, dict[str, str]] | None:
    if not cookies:
        return None
    with requests.Session() as http:
        http.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
            }
        )
        for name, value in cookies.items():
            http.cookies.set(name, value, domain=".login.microsoftonline.com", path="/")

        resp = http.get(
            AUTHORIZE_URL,
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "scope": "openid email profile",
                "redirect_uri": REDIRECT_URI,
                "state": str(uuid.uuid4()),
            },
            allow_redirects=False,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )

        code = None
        if resp.status_code in (301, 302, 303, 307, 308):
            code = _extract_code_from_url(resp.headers.get("Location") or "")
        elif resp.status_code == 200 and resp.text:
            match = _CODE_RE.search(resp.text)
            if match:
                code = match.group(1)

        if not code:
            return None

        updated_cookies = dict(cookies)
        for cookie in http.cookies:
            if "login.microsoftonline.com" in (cookie.domain or "") and cookie.value:
                updated_cookies[cookie.name] = cookie.value

        session_jwt, portal_jwt = _exchange_code_for_tokens(http, code)
        return session_jwt, portal_jwt, updated_cookies


def _try_fill_microsoft_or_adfs(
    page, entra_email: str | None, adfs_username: str | None, password: str | None
) -> None:
    """Best-effort form fill for Entra ID (#i0116/#i0118) or UOIT ADFS (#userNameInput/#passwordInput)."""
    if not password:
        return
    try:
        # Entra ID email step
        email_box = page.locator("#i0116").first
        if entra_email and email_box.count() and email_box.is_visible():
            email_box.fill(entra_email)
            next_btn = page.locator("#idSIButton9").first
            if next_btn.count() and next_btn.is_visible():
                next_btn.click()
                page.wait_for_timeout(500)
                return

        # Entra ID password step
        pw_box = page.locator("#i0118").first
        if pw_box.count() and pw_box.is_visible():
            pw_box.fill(password)
            sign_in_btn = page.locator("#idSIButton9").first
            if sign_in_btn.count() and sign_in_btn.is_visible():
                sign_in_btn.click()
                page.wait_for_timeout(500)
                return

        # UOIT ADFS federated login (#userNameInput / #passwordInput)
        adfs_user = page.locator("#userNameInput").first
        if adfs_username and adfs_user.count() and adfs_user.is_visible():
            adfs_user.fill(adfs_username)
            adfs_pw = page.locator("#passwordInput").first
            if not (adfs_pw.count() and adfs_pw.is_visible()):
                page.locator("#submitButton").first.click()
                adfs_pw.wait_for(state="visible", timeout=10_000)
            adfs_pw.fill(password)
            page.locator("#submitButton").first.click()
            page.wait_for_timeout(500)
            return

        # KMSI "Stay signed in?" prompt
        kmsi_yes = page.locator("#idSIButton9").first
        kmsi_check = page.locator("#KmsiCheckboxField, #kmsiInput").first
        if (
            "login.microsoftonline.com" in page.url
            and kmsi_check.count()
            and kmsi_check.is_visible()
        ):
            if not kmsi_check.is_checked():
                kmsi_check.check()
            if kmsi_yes.count() and kmsi_yes.is_visible():
                kmsi_yes.click()
                page.wait_for_timeout(500)
    except Exception:
        pass


def _login_via_playwright(seed_cookies: dict[str, str]) -> tuple[str, str, dict[str, str]]:
    """Headless Playwright with UOIT credentials/cookies, falling back to interactive locally."""
    import time
    from playwright.sync_api import sync_playwright

    entra_email = os.getenv("UOIT_EMAIL") or os.getenv("UOIT_USERNAME")
    adfs_username = os.getenv("UOIT_USERNAME") or os.getenv("UOIT_EMAIL")
    password = os.getenv("UOIT_PASSWORD")

    auth_url = (
        requests.Request(
            "GET",
            AUTHORIZE_URL,
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "scope": "openid email profile",
                "redirect_uri": REDIRECT_URI,
                "state": str(uuid.uuid4()),
            },
        )
        .prepare()
        .url
    )
    assert auth_url is not None

    in_ci = bool(os.environ.get("CI"))
    has_creds = bool(entra_email and password)
    if in_ci:
        modes = [True] if (seed_cookies or has_creds) else []
    else:
        modes = [True, False] if (seed_cookies or has_creds) else [False]

    for headless in modes:
        captured: dict[str, str] = {}
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            try:
                context = browser.new_context(user_agent=USER_AGENT)
                if seed_cookies:
                    context.add_cookies(
                        [
                            {
                                "name": name,
                                "value": value,
                                "domain": ".login.microsoftonline.com",
                                "path": "/",
                                "secure": True,
                            }
                            for name, value in seed_cookies.items()
                            if value
                        ]
                    )
                page = context.new_page()

                def _on_response(response) -> None:
                    if response.status != 200:
                        return
                    try:
                        if "/api/session/authFromCode" in response.url:
                            data = response.json()
                            jwt = (data.get("response") or {}).get("jwt")
                            if data.get("success") and jwt:
                                captured["session_jwt"] = jwt
                        elif "/api/session/token" in response.url:
                            data = response.json()
                            if data.get("success") and data.get("response"):
                                captured["portal_jwt"] = data["response"]
                    except Exception:
                        pass

                page.on("response", _on_response)
                page.goto(auth_url)

                deadline = time.monotonic() + (25 if headless else 300)
                while time.monotonic() < deadline:
                    if "session_jwt" in captured and "portal_jwt" in captured:
                        updated = dict(seed_cookies)
                        for c in context.cookies():
                            if "login.microsoftonline.com" in (c.get("domain") or "").lower() and c.get("value"):
                                updated[c["name"]] = c["value"]
                        return captured["session_jwt"], captured["portal_jwt"], updated
                    _try_fill_microsoft_or_adfs(page, entra_email, adfs_username, password)
                    page.wait_for_timeout(200)
            finally:
                browser.close()

    raise RuntimeError("Timed out waiting for Infosilem authentication tokens.")


def get_portal_token() -> str:
    """Obtain a fresh Infosilem PortalApi Bearer JWT."""
    cookies = _load_cookies()
    result = None
    if cookies:
        try:
            result = _try_silent_oauth(cookies)
        except Exception as exc:
            print(f"Silent OAuth failed ({exc})")
            result = None

    if result is None:
        has_creds = bool((os.getenv("UOIT_EMAIL") or os.getenv("UOIT_USERNAME")) and os.getenv("UOIT_PASSWORD"))
        if os.environ.get("CI") and not cookies and not has_creds:
            raise RuntimeError(
                "Missing UOIT_EMAIL/UOIT_PASSWORD or INFOSILEM_COOKIES_JSON in CI."
            )
        print("Trying Playwright for Infosilem login...")
        result = _login_via_playwright(cookies)

    session_jwt, portal_jwt, updated_cookies = result
    _save_local_session(session_jwt, portal_jwt, updated_cookies)
    return portal_jwt


def _post_infosilem(
    url: str, payload: dict[str, Any], token: str | None = None
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = requests.post(
        url,
        headers=headers,
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or not data.get("success"):
        raise RuntimeError(f"Infosilem request to {url} failed: {data!r}")
    return data


def _to_room_detail_row(room: dict[str, Any], now_iso: str) -> dict[str, Any] | None:
    list_data = room.get("listData") or []
    room_code = list_data[2].strip() if len(list_data) > 2 and list_data[2] else None
    if not room_code:
        return None
    cap_raw = list_data[4].strip() if len(list_data) > 4 and list_data[4] else ""
    capacity = int(cap_raw) if cap_raw.isdigit() else None
    return {
        "room": room_code,
        "campus": list_data[0].strip() if len(list_data) > 0 and list_data[0] else None,
        "building": list_data[1].strip() if len(list_data) > 1 and list_data[1] else None,
        "room_type": list_data[3].strip() if len(list_data) > 3 and list_data[3] else None,
        "capacity": capacity,
        "config_type": list_data[6].strip() if len(list_data) > 6 and list_data[6] else None,
        "description": list_data[7].strip() if len(list_data) > 7 and list_data[7] else None,
        "raw_data": room,
        "updated_at": now_iso,
    }


def _epoch_to_date(epoch: Any) -> str | None:
    if epoch is None:
        return None
    try:
        return datetime.fromtimestamp(int(epoch), tz=timezone.utc).date().isoformat()
    except (TypeError, ValueError, OSError):
        return None


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(
        description="Scrape Infosilem room details & reservations into Supabase."
    )
    parser.add_argument(
        "--local",
        action="store_true",
        help="Authenticate via local .infosilem_session.json / Playwright to include all restricted rooms.",
    )
    args = parser.parse_args(argv)

    token: str | None = None
    if args.local:
        print("Authenticating with Infosilem Campus Portal (--local)...")
        token = get_portal_token()
    else:
        print("Running unauthenticated Infosilem scrape (public rooms only)...")

    print("Fetching room registry (searchRooms)...")
    search_payload = _post_infosilem(SEARCH_ROOMS_URL, DEFAULT_SEARCH_PAYLOAD, token)
    rooms = (search_payload.get("response") or {}).get("data") or []
    if args.local and len(rooms) < MIN_AUTH_ROOM_COUNT:
        print(
            f"Warning: searchRooms returned only {len(rooms)} rooms "
            f"(expected >= {MIN_AUTH_ROOM_COUNT} when authenticated)."
        )

    room_guids = [r["rowId"] for r in rooms if r.get("rowId")]
    guid_to_room_id = {
        r["rowId"]: r["listData"][2].strip()
        for r in rooms
        if r.get("rowId") and len(r.get("listData") or []) >= 3 and r["listData"][2]
    }
    print(f"Retrieved {len(rooms)} rooms.")

    start_date, end_date = DEFAULT_CALENDAR_RANGE
    print(f"Fetching room schedules (roomCalendar) for {len(room_guids)} rooms...")
    cal_payload = _post_infosilem(
        ROOM_CALENDAR_URL,
        {
            "startDate": start_date,
            "endDate": end_date,
            "listView": False,
            "recordIds": room_guids,
        },
        token,
    )

    now_iso = utc_now_iso()
    detail_by_room: dict[str, dict[str, Any]] = {}
    for r in rooms:
        row = _to_room_detail_row(r, now_iso)
        if row:
            detail_by_room[row["room"]] = row
    detail_rows = list(detail_by_room.values())

    reservations_by_guid = (cal_payload.get("response") or {}).get("detailedReservations") or {}
    reservation_rows: list[dict[str, Any]] = []
    for guid, res_list in reservations_by_guid.items():
        room_id = guid_to_room_id.get(guid, guid)
        for res in res_list or []:
            content = res.get("content") or {}
            title = content.get("popupContent")
            res_type = content.get("cellContent") or "reservation"
            for occ in res.get("occurrences") or []:
                day = occ.get("day")
                start_time = occ.get("startTime")
                duration = occ.get("duration")
                if day is None or start_time is None or duration is None:
                    continue
                reservation_rows.append(
                    {
                        "room_id": room_id,
                        "day": int(day),
                        "start_time": int(start_time),
                        "duration": int(duration),
                        "end_time": int(start_time) + int(duration),
                        "booking_date": _epoch_to_date(occ.get("date")),
                        "title": title,
                        "type": res_type,
                        "updated_at": now_iso,
                    }
                )

    print(
        f"Prepared {len(detail_rows)} room_booking_details and "
        f"{len(reservation_rows)} room_detailed_reservations."
    )

    supabase = get_supabase()

    upserted_details = 0
    for batch in batches(detail_rows):
        supabase.table("room_booking_details").upsert(batch, on_conflict="room").execute()
        upserted_details += len(batch)
    print(f"room_booking_details: {upserted_details} upserted.")

    # Only delete reservations for rooms returned by THIS scrape so unauthenticated
    # runs never wipe out extra rooms populated by an earlier --local run.
    scraped_room_ids = sorted(
        {r["room"] for r in detail_rows} | {r["room_id"] for r in reservation_rows}
    )
    for id_batch in batches(scraped_room_ids, size=100):
        supabase.table("room_detailed_reservations").delete().in_(
            "room_id", id_batch
        ).execute()

    inserted_res = 0
    for batch in batches(reservation_rows):
        supabase.table("room_detailed_reservations").insert(batch).execute()
        inserted_res += len(batch)
    print(
        f"room_detailed_reservations: {inserted_res} inserted across "
        f"{len(scraped_room_ids)} scraped rooms."
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
