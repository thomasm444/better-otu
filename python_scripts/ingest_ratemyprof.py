"""Scrape RateMyProfessors data for Ontario Tech faculty and ingest into Supabase."""

from __future__ import annotations

import argparse
import html
import json
import re
import time
from collections import defaultdict
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any

import requests

from db import LOCAL_DIR, batches, get_supabase, load_env, utc_now_iso

RMP_GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
ONTARIO_TECH_SCHOOL_ID = "U2Nob29sLTQ3MTQ="
MATCH_THRESHOLD = 80.0  # Minimum fuzzy match score (>= 80.0% required)
WTA_CUTOFF_DATE = "2016-05-25"

SEARCH_BATCH_SIZE = 40
NODE_BATCH_SIZE = 20
RATINGS_PAGE_SIZE = 250
REQUEST_DELAY_SECONDS = 0.15
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) "
        "Gecko/20100101 Firefox/159.0"
    ),
    "Content-Type": "application/json",
}

# Common RMP shorthand prefixes -> Ontario Tech subject codes
SUBJECT_ALIASES: dict[str, str] = {
    "BIO": "BIOL",
    "CHM": "CHEM",
    "PHY": "PHYS",
    "MTH": "MATH",
    "MAT": "MATH",
    "CSC": "CSCI",
    "CS": "CSCI",
    "PSY": "PSYC",
    "SOC": "SOCI",
    "BUS": "BUSI",
    "CRM": "CRMN",
    "CRIM": "CRMN",
    "ECO": "ECON",
    "ENG": "ENGR",
    "MEC": "MECE",
    "MECH": "MECE",
    "ELE": "ELEE",
    "SOF": "SOFE",
    "SOFT": "SOFE",
    "NUC": "NUCL",
    "NUCL": "NUCL",
    "HLS": "HLSC",
    "NUR": "NURS",
    "LGL": "LGLS",
    "COM": "COMM",
    "POL": "POSC",
    "POS": "POSC",
    "EDU": "EDUC",
    "CUR": "CURS",
    "KIN": "KINE",
    "INF": "INFR",
    "IT": "INFR",
    "AUT": "AUTE",
    "MAN": "MANE",
    "STA": "STAT",
    "ENV": "ENVS",
    "FOR": "FSCI",
    "FSC": "FSCI",
    "DAT": "DATA",
    "MTR": "MTSC",
    "MAE": "MECE",
    "SCI": "SCIE",
    "SSC": "SSCI",
}

_COURSE_CODE_RE = re.compile(r"^([A-Z]{2,6})\s*[- ]?\s*(\d{3,4}[A-Z]?)$")
_NUMBER_ONLY_RE = re.compile(r"^(\d{3,4}[A-Z]?)$")


@lru_cache(maxsize=65536)
def token_sim(a: str, b: str) -> float:
    """Token similarity ported from local/tgraphql/temp.py."""
    if a == b:
        return 1.0
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= 3 and longer.startswith(shorter):
        return 0.92
    return SequenceMatcher(None, a, b).ratio()


def name_score(n1: str, n2: str) -> float:
    """Fuzzy full-name match score (0-100) ported from local/tgraphql/temp.py."""
    t1 = re.findall(r"[a-z]+", n1.lower())
    t2 = re.findall(r"[a-z]+", n2.lower())
    if not t1 or not t2:
        return 0.0
    best = 0.0
    for i1 in range(len(t1)):
        for i2 in range(len(t1)):
            if i1 == i2 and len(t1) > 1:
                continue
            for j1 in range(len(t2)):
                for j2 in range(len(t2)):
                    if j1 == j2 and len(t2) > 1:
                        continue
                    s1, s2 = token_sim(t1[i1], t2[j1]), token_sim(t1[i2], t2[j2])
                    best = max(best, min(s1, s2) * 0.65 + ((s1 + s2) / 2) * 0.35)
    return round(best * 100, 1)


def format_search_name(display_name: str) -> str:
    """Convert Banner 'Last, First' display_name into 'First Last'."""
    cleaned = html.unescape(display_name).strip()
    if "," in cleaned:
        last, first = [part.strip() for part in cleaned.split(",", 1)]
        return f"{first} {last}".strip()
    return cleaned


def _post_graphql(
    http: requests.Session, query: str, variables: dict[str, Any]
) -> dict[str, Any]:
    """POST a GraphQL request to RateMyProfessors with retry and backoff."""
    last_exc: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = http.post(
                RMP_GRAPHQL_URL,
                json={"query": query, "variables": variables},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("errors") and not payload.get("data"):
                raise RuntimeError(f"RMP GraphQL error: {payload['errors']!r}")
            return payload.get("data") or {}
        except Exception as exc:
            last_exc = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(0.5 * (2**attempt))
    raise RuntimeError(f"RMP GraphQL request failed after {MAX_RETRIES} retries: {last_exc}")


def _fetch_all_rows(
    supabase, table: str, select: str, order_col: str
) -> list[dict[str, Any]]:
    """Paginate deterministically past PostgREST's 1,000-row cap for *table*."""
    rows: list[dict[str, Any]] = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            supabase.table(table)
            .select(select)
            .order(order_col, desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = resp.data or []
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def load_supabase_context(supabase) -> dict[str, Any]:
    """Load faculty names, Banner courses, and catalog courses from Supabase."""
    faculty_rows = _fetch_all_rows(
        supabase, "course_faculty", "id, course_id, display_name, term", "id"
    )
    course_rows = _fetch_all_rows(
        supabase,
        "courses",
        "id, term, subject, course_number, subject_course, course_title",
        "id",
    )
    catalog_rows = _fetch_all_rows(
        supabase,
        "catalog_courses",
        "code, subject, number, subject_course, title, formerly_codes",
        "code",
    )

    courses_by_id: dict[int, dict[str, Any]] = {
        int(c["id"]): c for c in course_rows if c.get("id") is not None
    }

    catalog_by_compact: dict[str, dict[str, Any]] = {}
    course_by_compact: dict[str, dict[str, Any]] = {}
    by_prefix_num: dict[tuple[str, str], str] = {}

    for row in catalog_rows:
        code = (row.get("code") or "").strip().upper()
        subj = (row.get("subject") or "").strip().upper()
        num = (row.get("number") or "").strip().upper()
        compact = (row.get("subject_course") or f"{subj}{num}").strip().upper()
        title = row.get("title")
        if not code or not compact:
            continue
        info = {"code": code, "subject_course": compact, "title": title, "in_catalog": True}
        catalog_by_compact[compact] = info
        course_by_compact[compact] = info
        m = re.match(r"^(\d{3,4})", num)
        if subj and m:
            by_prefix_num.setdefault((subj, m.group(1)), compact)

        for fc in row.get("formerly_codes") or []:
            fc_compact = re.sub(r"[^A-Z0-9]", "", str(fc).upper())
            if fc_compact and fc_compact not in course_by_compact:
                course_by_compact[fc_compact] = {
                    "code": code,
                    "subject_course": compact,
                    "title": title,
                    "in_catalog": True,
                }

    for row in course_rows:
        subj = (row.get("subject") or "").strip().upper()
        num = (row.get("course_number") or "").strip().upper()
        if not subj or not num:
            continue
        compact = f"{subj}{num}"
        code = f"{subj} {num}"
        title = row.get("course_title")
        if compact not in course_by_compact:
            course_by_compact[compact] = {
                "code": code,
                "subject_course": compact,
                "title": title,
                "in_catalog": False,
            }
        elif not course_by_compact[compact].get("title") and title:
            course_by_compact[compact]["title"] = title
        m = re.match(r"^(\d{3,4})", num)
        if m:
            by_prefix_num.setdefault((subj, m.group(1)), compact)

    # Map display_name -> {compact_course_code -> {terms: set, title: str|None, sections: int}}
    banner_courses_by_name: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    section_count_by_name: dict[str, int] = defaultdict(int)

    for fac in faculty_rows:
        disp = (fac.get("display_name") or "").strip()
        if not disp:
            continue
        section_count_by_name[disp] += 1
        course = courses_by_id.get(int(fac["course_id"])) if fac.get("course_id") is not None else None
        if not course:
            continue
        subj = (course.get("subject") or "").strip().upper()
        num = (course.get("course_number") or "").strip().upper()
        if not subj or not num:
            continue
        compact = f"{subj}{num}"
        meta = course_by_compact.get(compact) or {}
        canonical_compact = meta.get("subject_course") or compact
        entry = banner_courses_by_name[disp].get(canonical_compact)
        if entry is None:
            entry = {
                "course_code": meta.get("code") or f"{subj} {num}",
                "subject_course": canonical_compact,
                "course_title": meta.get("title") or course.get("course_title"),
                "catalog_course_code": meta["code"] if meta.get("in_catalog") else None,
                "terms": set(),
            }
            banner_courses_by_name[disp][canonical_compact] = entry
        term = fac.get("term") or course.get("term")
        if term:
            entry["terms"].add(str(term))

    return {
        "display_names": sorted(section_count_by_name.keys()),
        "section_count_by_name": dict(section_count_by_name),
        "banner_courses_by_name": dict(banner_courses_by_name),
        "catalog_by_compact": catalog_by_compact,
        "course_by_compact": course_by_compact,
        "by_prefix_num": by_prefix_num,
    }


def search_and_match_professors(
    http: requests.Session,
    display_names: list[str],
    section_count_by_name: dict[str, int],
) -> dict[str, dict[str, Any]]:
    """Search top 5 RMP results per instructor; prefer the first match with ratings while score >= 80.0%."""
    matched_by_prof_id: dict[str, dict[str, Any]] = {}

    for batch_idx, batch in enumerate(batches(display_names, SEARCH_BATCH_SIZE)):
        var_defs = []
        fields = []
        variables: dict[str, Any] = {}
        search_names: list[str] = []

        for idx, disp in enumerate(batch):
            search_name = format_search_name(disp)
            search_names.append(search_name)
            vname = f"q{idx}"
            var_defs.append(f"${vname}: TeacherSearchQuery!")
            fields.append(
                f"{vname}: newSearch {{ teachers(query: ${vname}, first: 5) {{ "
                f"edges {{ node {{ id legacyId firstName lastName numRatings }} }} }} }}"
            )
            variables[vname] = {"text": search_name, "schoolID": ONTARIO_TECH_SCHOOL_ID}

        query_str = (
            f"query BatchSearch({', '.join(var_defs)}) {{\n  "
            + "\n  ".join(fields)
            + "\n}"
        )
        data = _post_graphql(http, query_str, variables)

        for idx, disp in enumerate(batch):
            search_name = search_names[idx]
            edges = ((data.get(f"q{idx}") or {}).get("teachers") or {}).get("edges") or []
            chosen_node: dict[str, Any] | None = None
            chosen_score = -1.0

            for edge in edges:
                node = (edge or {}).get("node") or {}
                fn = (node.get("firstName") or "").strip()
                ln = (node.get("lastName") or "").strip()
                rmp_name = f"{fn} {ln}".strip()
                score = name_score(search_name, rmp_name)
                if score < MATCH_THRESHOLD:
                    break

                if chosen_node is None:
                    chosen_node = node
                    chosen_score = score

                if int(node.get("numRatings") or 0) > 0:
                    chosen_node = node
                    chosen_score = score
                    break

            if not chosen_node:
                continue

            prof_id = str(chosen_node["id"])
            existing = matched_by_prof_id.get(prof_id)
            sec_count = section_count_by_name.get(disp, 0)
            cand_rank = (chosen_score, sec_count)
            if existing is None:
                matched_by_prof_id[prof_id] = {
                    "id": prof_id,
                    "legacy_id": chosen_node.get("legacyId"),
                    "matched_display_names": {disp},
                    "best_match_display_name": disp,
                    "match_score": chosen_score,
                    "_best_rank": cand_rank,
                }
            else:
                existing["matched_display_names"].add(disp)
                existing["match_score"] = max(existing["match_score"], chosen_score)
                if cand_rank > existing["_best_rank"]:
                    existing["_best_rank"] = cand_rank
                    existing["best_match_display_name"] = disp

        if batch_idx > 0:
            time.sleep(REQUEST_DELAY_SECONDS)

    return matched_by_prof_id


_RATING_FIELDS = """
  id
  class
  qualityRating
  difficultyRating
  wouldTakeAgain
  date
"""


def _fetch_remaining_ratings(
    http: requests.Session, prof_id: str, cursor: str
) -> list[dict[str, Any]]:
    """Paginate past the initial 250 ratings when a professor has >250 reviews."""
    extra: list[dict[str, Any]] = []
    query = f"""
    query MoreRatings($id: ID!, $after: String) {{
      node(id: $id) {{
        ... on Teacher {{
          ratings(first: {RATINGS_PAGE_SIZE}, after: $after) {{
            pageInfo {{ hasNextPage endCursor }}
            edges {{ node {{ {_RATING_FIELDS} }} }}
          }}
        }}
      }}
    }}
    """
    next_cursor: str | None = cursor
    while next_cursor:
        data = _post_graphql(http, query, {"id": prof_id, "after": next_cursor})
        ratings_conn = ((data.get("node") or {}).get("ratings")) or {}
        for edge in ratings_conn.get("edges") or []:
            node = (edge or {}).get("node")
            if node:
                extra.append(node)
        page_info = ratings_conn.get("pageInfo") or {}
        if page_info.get("hasNextPage") and page_info.get("endCursor"):
            next_cursor = page_info["endCursor"]
            time.sleep(REQUEST_DELAY_SECONDS)
        else:
            next_cursor = None
    return extra


def fetch_professor_details(
    http: requests.Session, prof_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """Fetch full Teacher metrics, distributions, and all individual ratings."""
    details_by_id: dict[str, dict[str, Any]] = {}

    for batch_idx, batch in enumerate(batches(prof_ids, NODE_BATCH_SIZE)):
        var_defs = []
        fields = []
        variables: dict[str, Any] = {}

        for idx, pid in enumerate(batch):
            vname = f"id{idx}"
            var_defs.append(f"${vname}: ID!")
            fields.append(
                f"""n{idx}: node(id: ${vname}) {{
                  ... on Teacher {{
                    id
                    legacyId
                    firstName
                    lastName
                    department
                    departmentId
                    avgRating
                    avgDifficulty
                    numRatings
                    wouldTakeAgainCount
                    wouldTakeAgainPercent
                    ratingsDistribution {{ r1 r2 r3 r4 r5 total }}
                    ratings(first: {RATINGS_PAGE_SIZE}) {{
                      pageInfo {{ hasNextPage endCursor }}
                      edges {{ node {{ {_RATING_FIELDS} }} }}
                    }}
                  }}
                }}"""
            )
            variables[vname] = pid

        query_str = (
            f"query BatchTeachers({', '.join(var_defs)}) {{\n  "
            + "\n  ".join(fields)
            + "\n}"
        )
        data = _post_graphql(http, query_str, variables)

        for idx, pid in enumerate(batch):
            node = data.get(f"n{idx}") or {}
            if not node:
                continue
            ratings_conn = node.get("ratings") or {}
            ratings = [
                e["node"] for e in (ratings_conn.get("edges") or []) if (e or {}).get("node")
            ]
            page_info = ratings_conn.get("pageInfo") or {}
            if page_info.get("hasNextPage") and page_info.get("endCursor"):
                ratings.extend(
                    _fetch_remaining_ratings(http, pid, page_info["endCursor"])
                )
            node["_all_ratings"] = ratings
            details_by_id[pid] = node

        if batch_idx > 0:
            time.sleep(REQUEST_DELAY_SECONDS)

    return details_by_id


def normalize_rmp_course(
    raw_class: str | None,
    prof_banner_courses: dict[str, dict[str, Any]],
    ctx: dict[str, Any],
) -> tuple[str, str, str | None, str | None]:
    """
    Map an RMP `class` string to (course_code, subject_course, course_title, catalog_course_code).
    Prefers courses actually taught by the professor in Banner before global lookups.
    """
    cleaned = re.sub(r"\s+", "", (raw_class or "").upper())
    if not cleaned or cleaned in {"NONE", "NA", "N/A", "MANY", "ALL", "VARIOUS"}:
        label = cleaned or "OTHER"
        return label, label, None, None

    catalog_by_compact = ctx["catalog_by_compact"]
    course_by_compact = ctx["course_by_compact"]
    by_prefix_num = ctx["by_prefix_num"]

    def _from_compact(compact_code: str) -> tuple[str, str, str | None, str | None] | None:
        if compact_code in prof_banner_courses:
            bc = prof_banner_courses[compact_code]
            return (
                bc["course_code"],
                bc["subject_course"],
                bc.get("course_title"),
                bc.get("catalog_course_code"),
            )
        if compact_code in course_by_compact:
            meta = course_by_compact[compact_code]
            cat_code = meta["code"] if compact_code in catalog_by_compact else (
                meta["code"] if meta.get("in_catalog") else None
            )
            return meta["code"], meta["subject_course"], meta.get("title"), cat_code
        return None

    # 1. Exact compact match (e.g. "BIOL1010U" or "CSCI1030U")
    direct = _from_compact(cleaned)
    if direct:
        return direct

    # 2. Extract subject + number (e.g. "BIO1010", "BIO1010U", "LGLS-294U", "SOFE3720")
    raw_spaced = re.sub(r"[-_]+", " ", (raw_class or "").upper()).strip()
    match = _COURSE_CODE_RE.match(raw_spaced) or _COURSE_CODE_RE.match(cleaned)
    if match:
        subj, num = match.group(1), match.group(2)
        mapped_subj = SUBJECT_ALIASES.get(subj, subj)
        num_digits = re.match(r"^(\d{3,4})", num)
        digits = num_digits.group(1) if num_digits else num

        # Try professor's own Banner courses first (with mapped or raw subject, or 4-digit match)
        for cand_subj in dict.fromkeys((mapped_subj, subj)):
            for suffix in ("", "U", "G"):
                cand = f"{cand_subj}{num if not suffix or num.endswith(('U', 'G')) else digits + suffix}"
                res = _from_compact(cand)
                if res:
                    return res

            # Global lookup by (subject, 4-digit number)
            global_compact = by_prefix_num.get((cand_subj, digits))
            if global_compact:
                res = _from_compact(global_compact)
                if res:
                    return res

        # If professor teaches a single course with this exact course number
        if len(digits) == 4:
            matched_bc = _match_prof_course_by_digits(digits, prof_banner_courses)
            if matched_bc:
                return matched_bc

        # Fallback: preserve clean formatted code (e.g. "BIOL 101" or "LGLS 294U")
        pretty = f"{mapped_subj} {num}"
        return pretty, f"{mapped_subj}{num}", None, None

    # 3. Number-only RMP tag (e.g. "3720U" -> professor's "ENGR 3720U" / "SOFE 3720U")
    num_match = _NUMBER_ONLY_RE.match(cleaned)
    if num_match:
        digits = re.match(r"^(\d{3,4})", cleaned).group(1)
        matched_bc = _match_prof_course_by_digits(digits, prof_banner_courses)
        if matched_bc:
            return matched_bc

    return cleaned, cleaned, None, None


def _match_prof_course_by_digits(
    digits: str,
    prof_banner_courses: dict[str, dict[str, Any]],
) -> tuple[str, str, str | None, str | None] | None:
    """Return a professor's Banner course metadata if *digits* uniquely identifies one."""
    num_pat = re.compile(rf"^[A-Z]+{re.escape(digits)}[A-Z]?$")
    matches = [
        c for c in prof_banner_courses.values()
        if num_pat.match(c["subject_course"])
    ]
    if len(matches) != 1:
        return None
    bc = matches[0]
    return (
        bc["course_code"],
        bc["subject_course"],
        bc.get("course_title"),
        bc.get("catalog_course_code"),
    )


def compute_rating_metrics(ratings: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute quality, difficulty, would-take-again %, and 1-5 counts from review nodes."""
    counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    q_sum = 0.0
    q_n = 0
    d_sum = 0.0
    d_n = 0
    wta_yes = 0
    wta_total = 0

    for r in ratings:
        q = r.get("qualityRating")
        if isinstance(q, (int, float)) and 1 <= round(q) <= 5:
            bucket = int(round(q))
            counts[bucket] += 1
            q_sum += float(q)
            q_n += 1

        d = r.get("difficultyRating")
        if isinstance(d, (int, float)) and d > 0:
            d_sum += float(d)
            d_n += 1

        wta = r.get("wouldTakeAgain")
        date_str = (r.get("date") or "")[:10]
        if wta in (0, 1) or date_str >= WTA_CUTOFF_DATE:
            wta_total += 1
            if wta == 1:
                wta_yes += 1

    return {
        "num_ratings": q_n,
        "avg_rating": round(q_sum / q_n, 2) if q_n > 0 else None,
        "avg_difficulty": round(d_sum / d_n, 2) if d_n > 0 else None,
        "would_take_again_count": wta_total,
        "would_take_again_percent": round((wta_yes / wta_total) * 100, 2) if wta_total > 0 else None,
        "r1": counts[1],
        "r2": counts[2],
        "r3": counts[3],
        "r4": counts[4],
        "r5": counts[5],
    }


def build_rows(
    matched: dict[str, dict[str, Any]],
    details_by_id: dict[str, dict[str, Any]],
    ctx: dict[str, Any],
    now_iso: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build normalized rows for public.rmp_professors and public.rmp_professor_courses."""
    prof_rows: list[dict[str, Any]] = []
    course_rows: list[dict[str, Any]] = []

    banner_courses_by_name = ctx["banner_courses_by_name"]

    for prof_id, match_info in sorted(matched.items()):
        node = details_by_id.get(prof_id)
        if not node:
            continue

        ratings = node.get("_all_ratings") or []
        computed = compute_rating_metrics(ratings)

        dist = node.get("ratingsDistribution") or {}
        r1 = int(dist.get("r1") or 0) if dist else computed["r1"]
        r2 = int(dist.get("r2") or 0) if dist else computed["r2"]
        r3 = int(dist.get("r3") or 0) if dist else computed["r3"]
        r4 = int(dist.get("r4") or 0) if dist else computed["r4"]
        r5 = int(dist.get("r5") or 0) if dist else computed["r5"]

        # RMP sometimes lags updating Teacher.numRatings/avgRating on very recent reviews;
        # fall back to the computed metrics from fetched reviews when Teacher aggregates are 0.
        raw_num = int(node.get("numRatings") or 0)
        num_ratings = raw_num if raw_num > 0 else computed["num_ratings"]
        if raw_num > 0 and (node.get("avgRating") or 0) > 0:
            avg_rating = round(float(node["avgRating"]), 2)
        else:
            avg_rating = computed["avg_rating"]

        if raw_num > 0 and (node.get("avgDifficulty") or 0) > 0:
            avg_difficulty = round(float(node["avgDifficulty"]), 2)
        else:
            avg_difficulty = computed["avg_difficulty"]

        raw_wta_count = int(node.get("wouldTakeAgainCount") or 0)
        raw_wta_pct = node.get("wouldTakeAgainPercent")
        if raw_wta_count > 0 and raw_wta_pct is not None and float(raw_wta_pct) >= 0:
            wta_count = raw_wta_count
            wta_percent = round(float(raw_wta_pct), 2)
        else:
            wta_count = computed["would_take_again_count"]
            wta_percent = computed["would_take_again_percent"]

        first_name = (node.get("firstName") or "").strip()
        last_name = (node.get("lastName") or "").strip()
        full_name = f"{first_name} {last_name}".strip()
        matched_names = sorted(match_info["matched_display_names"])

        prof_rows.append(
            {
                "id": prof_id,
                "legacy_id": node.get("legacyId"),
                "first_name": first_name,
                "last_name": last_name,
                "full_name": full_name,
                "department": node.get("department"),
                "department_id": node.get("departmentId"),
                "best_match_display_name": match_info["best_match_display_name"],
                "matched_display_names": matched_names,
                "match_score": round(float(match_info["match_score"]), 2),
                "avg_rating": avg_rating,
                "avg_difficulty": avg_difficulty,
                "num_ratings": num_ratings,
                "would_take_again_percent": wta_percent,
                "would_take_again_count": wta_count,
                "r1": r1,
                "r2": r2,
                "r3": r3,
                "r4": r4,
                "r5": r5,
                "updated_at": now_iso,
            }
        )

        # Merge all courses taught in Banner across matched display_names
        prof_banner_courses: dict[str, dict[str, Any]] = {}
        for disp in matched_names:
            for compact, bc in (banner_courses_by_name.get(disp) or {}).items():
                if compact not in prof_banner_courses:
                    prof_banner_courses[compact] = {
                        "course_code": bc["course_code"],
                        "subject_course": bc["subject_course"],
                        "course_title": bc.get("course_title"),
                        "catalog_course_code": bc.get("catalog_course_code"),
                        "terms": set(bc.get("terms") or set()),
                    }
                else:
                    prof_banner_courses[compact]["terms"].update(bc.get("terms") or set())

        # Group RMP reviews by normalized course_code
        grouped: dict[str, dict[str, Any]] = {}
        for bc in prof_banner_courses.values():
            grouped[bc["course_code"]] = {
                "course_code": bc["course_code"],
                "subject_course": bc["subject_course"],
                "course_title": bc.get("course_title"),
                "catalog_course_code": bc.get("catalog_course_code"),
                "raw_course_codes": set(),
                "taught_in_banner": True,
                "terms_taught": sorted(bc["terms"]),
                "ratings": [],
            }

        for r in ratings:
            raw_cls = (r.get("class") or "").strip()
            c_code, subj_course, c_title, cat_code = normalize_rmp_course(
                raw_cls, prof_banner_courses, ctx
            )
            bucket = grouped.get(c_code)
            if bucket is None:
                bucket = {
                    "course_code": c_code,
                    "subject_course": subj_course,
                    "course_title": c_title,
                    "catalog_course_code": cat_code,
                    "raw_course_codes": set(),
                    "taught_in_banner": False,
                    "terms_taught": [],
                    "ratings": [],
                }
                grouped[c_code] = bucket
            if raw_cls:
                bucket["raw_course_codes"].add(raw_cls)
            bucket["ratings"].append(r)

        for c_code in sorted(grouped.keys()):
            g = grouped[c_code]
            metrics = compute_rating_metrics(g["ratings"])
            course_rows.append(
                {
                    "professor_id": prof_id,
                    "course_code": g["course_code"],
                    "subject_course": g["subject_course"],
                    "course_title": g["course_title"],
                    "catalog_course_code": g["catalog_course_code"],
                    "raw_course_codes": sorted(g["raw_course_codes"]),
                    "taught_in_banner": g["taught_in_banner"],
                    "terms_taught": g["terms_taught"],
                    "avg_rating": metrics["avg_rating"],
                    "avg_difficulty": metrics["avg_difficulty"],
                    "num_ratings": metrics["num_ratings"],
                    "would_take_again_percent": metrics["would_take_again_percent"],
                    "would_take_again_count": metrics["would_take_again_count"],
                    "r1": metrics["r1"],
                    "r2": metrics["r2"],
                    "r3": metrics["r3"],
                    "r4": metrics["r4"],
                    "r5": metrics["r5"],
                    "updated_at": now_iso,
                }
            )

    return prof_rows, course_rows


def write_local_snapshot(
    prof_rows: list[dict[str, Any]],
    course_rows: list[dict[str, Any]],
) -> None:
    """Save a local JSON snapshot under local/jsons/ratemyprof.json if local/jsons exists."""
    snapshot_dir = LOCAL_DIR / "jsons"
    if not snapshot_dir.exists():
        return
    snapshot_path = snapshot_dir / "ratemyprof.json"
    snapshot_path.write_text(
        json.dumps(
            {
                "generated_at": utc_now_iso(),
                "professor_count": len(prof_rows),
                "professor_course_count": len(course_rows),
                "rmp_professors": prof_rows,
                "rmp_professor_courses": course_rows,
            },
            indent=2,
        ),
        encoding="utf8",
    )
    print(f"Saved local snapshot to {snapshot_path}")


def upsert_into_supabase(
    supabase,
    prof_rows: list[dict[str, Any]],
    course_rows: list[dict[str, Any]],
) -> None:
    """Replace/upsert rmp_professors and rmp_professor_courses, then refresh FKs."""
    # Delete stale professors that no longer match (cascades to rmp_professor_courses)
    existing_profs = _fetch_all_rows(supabase, "rmp_professors", "id", "id")
    existing_ids = {row["id"] for row in existing_profs}
    current_ids = {row["id"] for row in prof_rows}
    stale_ids = sorted(existing_ids - current_ids)
    for id_batch in batches(stale_ids, size=200):
        supabase.table("rmp_professors").delete().in_("id", id_batch).execute()

    for batch in batches(prof_rows):
        supabase.table("rmp_professors").upsert(batch, on_conflict="id").execute()
    print(f"rmp_professors: {len(prof_rows)} upserted ({len(stale_ids)} stale deleted)")

    # Replace rmp_professor_courses per professor cleanly
    for id_batch in batches(sorted(current_ids), size=200):
        supabase.table("rmp_professor_courses").delete().in_("professor_id", id_batch).execute()

    inserted_courses = 0
    for batch in batches(course_rows):
        supabase.table("rmp_professor_courses").insert(batch).execute()
        inserted_courses += len(batch)
    print(f"rmp_professor_courses: {inserted_courses} inserted")

    supabase.rpc("refresh_rmp_professor_links", {}).execute()
    print("Refreshed rmp_professor_id foreign keys on course_faculty and exam_schedules.")


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = argparse.ArgumentParser(
        description="Scrape RateMyProfessors for Ontario Tech faculty (>80% match) and ingest into Supabase."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scrape, match, and aggregate without writing to Supabase.",
    )
    args = parser.parse_args(argv)

    supabase = get_supabase()
    print("Loading Ontario Tech faculty and courses from Supabase...")
    ctx = load_supabase_context(supabase)
    display_names = ctx["display_names"]
    print(f"Loaded {len(display_names)} unique instructor display names.")

    with requests.Session() as http:
        http.headers.update(HEADERS)
        print("Matching instructors against RateMyProfessors (score > 80.0%)...")
        matched = search_and_match_professors(
            http, display_names, ctx["section_count_by_name"]
        )
        print(f"Matched {len(matched)} unique RateMyProfessors profiles.")

        print("Fetching professor ratings and course breakdowns...")
        details_by_id = fetch_professor_details(http, sorted(matched.keys()))
        print(f"Fetched full details for {len(details_by_id)} professors.")

    now_iso = utc_now_iso()
    prof_rows, course_rows = build_rows(matched, details_by_id, ctx, now_iso)
    print(
        f"Prepared {len(prof_rows)} rmp_professors rows and "
        f"{len(course_rows)} rmp_professor_courses rows."
    )
    write_local_snapshot(prof_rows, course_rows)

    if args.dry_run:
        print("Dry run complete; skipping Supabase writes.")
        return 0

    try:
        upsert_into_supabase(supabase, prof_rows, course_rows)
    except Exception as exc:
        msg = str(exc)
        if "PGRST205" in msg or "rmp_professors" in msg or "42P01" in msg:
            raise RuntimeError(
                "RateMyProfessors tables do not exist in Supabase yet. "
                "Apply supabase/migrations/20261119120000_ratemyprof_schema.sql first."
            ) from exc
        raise

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
