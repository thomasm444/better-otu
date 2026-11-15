"""Headless-ready Banner authentication and term session capture for UOIT."""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from db import load_env

INIT_URL = (
    "https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/"
    "term/termSelection?mode=search&mepCode=UOIT"
)
GET_TERMS_URL = (
    "https://ssp.mycampus.ca/StudentRegistrationSsb/ssb/"
    "classSearch/getTerms"
)
TERM_SELECTION_GLOB = "**/term/termSelection*"

MANUAL_LOGIN_TIMEOUT_MS = 300_000
AUTO_LOGIN_TIMEOUT_MS = 60_000
_VIEW_ONLY_RE = re.compile(r"\s*\(view only\)\s*$", re.IGNORECASE)


@dataclass
class TermSession:
    """Session state required to paginate Banner searchResults for one term."""

    term_label: str | None = None
    term_code: str | None = None
    jsession_id: str | None = None
    unique_session_id: str | None = None
    synchronizer_token: str | None = None
    cookies: list[dict[str, str]] = field(default_factory=list)
    headers: dict[str, str] = field(default_factory=dict)


def get_credentials() -> tuple[str, str] | None:
    load_env()
    username = os.getenv("UOIT_USERNAME")
    password = os.getenv("UOIT_PASSWORD")
    if username and password:
        return username, password
    return None


def _submit(page) -> None:
    page.click("#submitButton")


def _login_error(page) -> str | None:
    for selector in ("#errorText", "#error", ".error"):
        locator = page.locator(selector).first
        try:
            if locator.count() and locator.is_visible():
                return (locator.inner_text() or "").strip()
        except Exception:
            continue
    return None


def _fill_login_form(page, username: str, password: str) -> bool:
    try:
        page.wait_for_selector("#userNameInput", state="visible", timeout=15_000)
    except PlaywrightTimeoutError:
        return False

    page.fill("#userNameInput", username)
    if not page.locator("#passwordInput").is_visible():
        _submit(page)
        page.wait_for_selector("#passwordInput", state="visible", timeout=15_000)

    page.fill("#passwordInput", password)
    _submit(page)
    return True


def _kmsi_visible(page) -> bool:
    try:
        return page.locator("#kmsiArea").is_visible() and page.locator("#kmsiInput").is_visible()
    except Exception:
        return False


def _wait_for_login_result(page, timeout_ms: int) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if "/term/termSelection" in page.url:
            return True
        error = _login_error(page)
        if error:
            raise RuntimeError(f"Sign-in failed: {error}")
        if _kmsi_visible(page):
            page.check("#kmsiInput")
            _submit(page)
            page.wait_for_timeout(500)
            continue
        page.wait_for_timeout(200)
    return False


def _open_authenticated_page(playwright, credentials, headless: bool):
    in_ci = bool(os.getenv("CI"))
    while True:
        browser = playwright.chromium.launch(headless=headless)
        page = browser.new_page()
        page.goto(INIT_URL)

        if credentials is None:
            if in_ci:
                browser.close()
                raise RuntimeError("Missing UOIT_USERNAME / UOIT_PASSWORD in CI.")
            print("No stored credentials. Please sign in in the browser window...")
            page.wait_for_url(TERM_SELECTION_GLOB, timeout=MANUAL_LOGIN_TIMEOUT_MS)
            return browser, page

        username, password = credentials
        if not _fill_login_form(page, username, password):
            if "/term/termSelection" in page.url:
                return browser, page
            browser.close()
            if headless and not in_ci:
                headless = False
                continue
            raise RuntimeError("Could not find the Banner sign-in form and no session is active.")

        try:
            signed_in = _wait_for_login_result(page, AUTO_LOGIN_TIMEOUT_MS)
        except RuntimeError:
            browser.close()
            raise

        if signed_in:
            return browser, page

        browser.close()
        if headless and not in_ci:
            print("Automatic sign-in failed, reopening a visible browser...")
            headless = False
            continue
        raise RuntimeError("Timed out waiting for Banner sign-in to complete.")


def _fetch_available_terms(page, page_size: int = 500) -> list[dict[str, str]]:
    terms: list[dict[str, str]] = []
    seen_codes: set[str] = set()
    offset = 1
    while True:
        try:
            response = page.context.request.get(
                GET_TERMS_URL,
                params={"searchTerm": "", "offset": offset, "max": page_size},
                timeout=30_000,
            )
            if response.status != 200:
                break
            batch = response.json()
        except Exception:
            break
        if not isinstance(batch, list) or not batch:
            break

        new_count = 0
        for item in batch:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or "").strip()
            description = str(item.get("description") or "").strip()
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            terms.append({"code": code, "description": description})
            new_count += 1
        if len(batch) < page_size or new_count == 0:
            break
        offset += len(batch)
    return terms


def _strip_view_only(label: str) -> str:
    return _VIEW_ONLY_RE.sub("", label).strip()


def match_term_entry(
    term: str, available_terms: list[dict[str, str]]
) -> dict[str, str] | None:
    if not available_terms:
        return None
    wanted = term.strip().lower()
    if not wanted:
        return available_terms[0]

    for matcher in (
        lambda e: e["code"].lower() == wanted,
        lambda e: e["description"].lower() == wanted,
        lambda e: _strip_view_only(e["description"]).lower() == wanted,
        lambda e: wanted in e["description"].lower(),
        lambda e: e["description"].lower().startswith(wanted),
    ):
        for entry in available_terms:
            if matcher(entry):
                return entry
    return None


def _match_visible_label(labels: list[tuple[int, str]], target: str) -> int | None:
    wanted = target.strip().lower()
    if not wanted:
        return 0 if labels else None
    for matcher in (
        lambda lbl: lbl.lower() == wanted,
        lambda lbl: _strip_view_only(lbl).lower() == wanted,
        lambda lbl: wanted in lbl.lower(),
        lambda lbl: lbl.lower().startswith(wanted),
    ):
        match = next((i for i, lbl in labels if matcher(lbl)), None)
        if match is not None:
            return match
    return None


def _read_select2_labels(page) -> tuple[object, list[tuple[int, str]]]:
    results = page.locator(".select2-results li.select2-result-selectable")
    labels = [
        (i, (results.nth(i).inner_text() or "").strip())
        for i in range(results.count())
    ]
    return results, labels


def _select_term(page, term: str, available_terms: list[dict[str, str]] | None = None) -> str:
    matched = match_term_entry(term, available_terms) if available_terms else None
    target_label = matched["description"] if matched else term

    page.wait_for_selector("#s2id_txt_term", state="visible")
    page.click("#s2id_txt_term")
    try:
        page.wait_for_selector(
            ".select2-results li.select2-result-selectable", state="visible", timeout=5_000
        )
    except PlaywrightTimeoutError:
        page.click("#s2id_txt_term")
        page.wait_for_selector(
            ".select2-results li.select2-result-selectable", state="visible", timeout=15_000
        )

    results, labels = _read_select2_labels(page)
    if not labels:
        raise RuntimeError("The Banner term dropdown is empty.")

    choice = _match_visible_label(labels, target_label)
    if choice is None and matched:
        choice = _match_visible_label(labels, term)

    if choice is None and term.strip():
        search_query = _strip_view_only(matched["description"]) if matched else term.strip()
        search_input = page.locator(".select2-drop-active input.select2-input").first
        search_input.click()
        search_input.fill(search_query[:-1])
        try:
            with page.expect_response(
                lambda r: "/getTerms" in r.url and r.status == 200, timeout=10_000
            ):
                search_input.press_sequentially(search_query[-1], delay=15)
        except PlaywrightTimeoutError:
            pass
        try:
            page.locator(".select2-results li.select2-searching").wait_for(
                state="hidden", timeout=10_000
            )
        except PlaywrightTimeoutError:
            pass
        page.wait_for_timeout(200)
        page.wait_for_selector(
            ".select2-results li.select2-result-selectable", state="visible", timeout=10_000
        )
        results, labels = _read_select2_labels(page)
        choice = _match_visible_label(labels, target_label)
        if choice is None and matched:
            choice = _match_visible_label(labels, term)

    if choice is None:
        available = ", ".join(lbl for _, lbl in labels)
        raise RuntimeError(f"No term matching {term!r}. Available: {available}")

    chosen_label = labels[choice][1]
    results.nth(choice).click()
    page.click("#term-go")
    return chosen_label


def _read_synchronizer_token(page, request_headers: dict) -> str | None:
    token = (request_headers or {}).get("x-synchronizer-token")
    if token:
        return token
    try:
        token = page.evaluate("() => window.sessionStorage.getItem('synchronizerToken')")
        if token:
            return token
    except Exception:
        pass
    match = re.search(
        r"['\"]synchronizerToken['\"]\s*[:=]\s*['\"]([\w-]{8,})['\"]", page.content()
    )
    return match.group(1) if match else None


def _capture_search(
    page, term: str, available_terms: list[dict[str, str]] | None = None
) -> TermSession:
    label = _select_term(page, term, available_terms=available_terms)
    page.wait_for_url("**/classSearch/classSearch", timeout=MANUAL_LOGIN_TIMEOUT_MS)
    page.wait_for_selector("#search-go", state="visible")

    with page.expect_response(lambda r: "/searchResults/searchResults" in r.url) as resp_info:
        page.click("#search-go")

    response = resp_info.value
    try:
        request_headers = response.request.all_headers()
    except Exception:
        request_headers = {}

    params = parse_qs(urlparse(response.url).query)
    cookies = [
        {
            "name": c["name"],
            "value": c["value"],
            "domain": c["domain"],
            "path": c["path"],
        }
        for c in page.context.cookies()
        if (c.get("domain") or "").lstrip(".") == "ssp.mycampus.ca"
    ]

    return TermSession(
        term_label=label,
        term_code=params.get("txt_term", [None])[0],
        jsession_id=next((c["value"] for c in cookies if c["name"] == "JSESSIONID"), None),
        unique_session_id=params.get("uniqueSessionId", [None])[0],
        synchronizer_token=_read_synchronizer_token(page, request_headers),
        cookies=cookies,
        headers={
            k: request_headers[k]
            for k in ("referer", "x-requested-with", "x-synchronizer-token")
            if k in request_headers
        },
    )


def _wait_for_term_selection_or_login(page, timeout_ms: int = 15_000) -> str:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if "/term/termSelection" in page.url:
            return "term_selection"
        try:
            if page.locator("#userNameInput").is_visible():
                return "login_form"
        except Exception:
            pass
        page.wait_for_timeout(150)
    return "timeout"


class BannerSession:
    """Reusable authenticated browser session for capturing Banner term sessions."""

    def __init__(self, headless: bool | None = None) -> None:
        self._credentials = get_credentials()
        if headless is None:
            headless = self._credentials is not None
        self.headless = headless
        self._playwright = None
        self._browser = None
        self._page = None
        self._term_captured = False
        self._available_terms: list[dict[str, str]] | None = None

    def __enter__(self) -> BannerSession:
        self.open()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def open(self) -> None:
        if self._page is not None:
            return
        self._playwright = sync_playwright().start()
        try:
            self._browser, self._page = _open_authenticated_page(
                self._playwright, self._credentials, self.headless
            )
            self._term_captured = False
        except Exception:
            self.close()
            raise

    def close(self) -> None:
        if self._browser is not None:
            try:
                self._browser.close()
            finally:
                self._browser = None
                self._page = None
                self._term_captured = False
        if self._playwright is not None:
            try:
                self._playwright.stop()
            finally:
                self._playwright = None

    def reauthenticate(self) -> None:
        if self._browser is not None:
            try:
                self._browser.close()
            finally:
                self._browser = None
                self._page = None
                self._term_captured = False
        if self._playwright is None:
            self._playwright = sync_playwright().start()
        self._browser, self._page = _open_authenticated_page(
            self._playwright, self._credentials, self.headless
        )

    def _reset_ssp_session(self) -> None:
        assert self._page is not None
        context = self._page.context
        keep = []
        for c in context.cookies():
            if (c.get("domain") or "").lstrip(".") == "ssp.mycampus.ca":
                continue
            cleaned = {
                k: c[k]
                for k in ("name", "value", "domain", "path", "httpOnly", "secure", "sameSite")
                if k in c
            }
            if isinstance(c.get("expires"), (int, float)) and c["expires"] > 0:
                cleaned["expires"] = c["expires"]
            keep.append(cleaned)

        context.clear_cookies()
        if keep:
            context.add_cookies(keep)

        old_page = self._page
        self._page = context.new_page()
        try:
            old_page.close()
        except Exception:
            pass

    def _ensure_term_selection(self) -> None:
        if self._page is None:
            self.open()
        assert self._page is not None

        if self._term_captured:
            self._reset_ssp_session()
            self._page.goto(INIT_URL)
            state = _wait_for_term_selection_or_login(self._page)
            if state == "login_form":
                if self._credentials is None:
                    self._page.wait_for_url(TERM_SELECTION_GLOB, timeout=MANUAL_LOGIN_TIMEOUT_MS)
                else:
                    username, password = self._credentials
                    if not (
                        _fill_login_form(self._page, username, password)
                        and _wait_for_login_result(self._page, AUTO_LOGIN_TIMEOUT_MS)
                    ):
                        self.reauthenticate()
            elif state == "timeout":
                self.reauthenticate()
            self._term_captured = False

        try:
            self._page.wait_for_selector("#s2id_txt_term", state="visible", timeout=15_000)
        except PlaywrightTimeoutError:
            self.reauthenticate()
            self._page.wait_for_selector("#s2id_txt_term", state="visible", timeout=15_000)

    def list_terms(self) -> list[dict[str, str]]:
        if self._available_terms is not None:
            return list(self._available_terms)
        self._ensure_term_selection()
        assert self._page is not None
        terms = _fetch_available_terms(self._page)
        if terms:
            self._available_terms = terms
        return list(terms)

    def open_term_session(self, term: str) -> TermSession:
        self._ensure_term_selection()
        available = self.list_terms()
        assert self._page is not None
        session = _capture_search(self._page, term, available_terms=available)
        self._term_captured = True
        return session
