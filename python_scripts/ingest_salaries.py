"""Ingest matched Ontario Tech professor salaries from local/otu_salary_matched.csv into Supabase."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Any

from db import LOCAL_DIR, batches, get_supabase, utc_now_iso

DEFAULT_CSV_PATH = LOCAL_DIR / "otu_salary_matched.csv"


def load_salary_rows(csv_path: Path, now_iso: str) -> list[dict[str, Any]]:
    """Read and normalize rows from *csv_path* for public.professor_salaries."""
    rows: list[dict[str, Any]] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            rows.append(
                {
                    "sector": raw["sector"].strip(),
                    "last_name": raw["last_name"].strip(),
                    "first_name": raw["first_name"].strip(),
                    "salary_paid": round(float(raw["salary_paid"]), 2),
                    "taxable_benefits": round(float(raw["taxable_benefits"]), 2),
                    "employer": raw["employer"].strip(),
                    "job_title": raw["job_title"].strip(),
                    "calendar_year": int(raw["calendar_year"]),
                    "rmp_professor_id": raw["rmp_professor_id"].strip(),
                    "updated_at": now_iso,
                }
            )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Ingest local/otu_salary_matched.csv into public.professor_salaries."
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help=f"Path to matched salary CSV (default: {DEFAULT_CSV_PATH})",
    )
    args = parser.parse_args(argv)

    if not args.csv.exists():
        raise FileNotFoundError(f"CSV file not found: {args.csv}")

    now_iso = utc_now_iso()
    rows = load_salary_rows(args.csv, now_iso)
    print(f"Loaded {len(rows)} rows from {args.csv}.")

    supabase = get_supabase()
    upserted = 0
    try:
        for batch in batches(rows):
            supabase.table("professor_salaries").upsert(
                batch,
                on_conflict="rmp_professor_id,calendar_year,last_name,first_name",
            ).execute()
            upserted += len(batch)
    except Exception as exc:
        msg = str(exc)
        if "PGRST205" in msg or "professor_salaries" in msg or "42P01" in msg:
            raise RuntimeError(
                "Table public.professor_salaries does not exist in Supabase yet. "
                "Apply supabase/migrations/20261123000000_professor_salaries.sql first."
            ) from exc
        raise

    print(f"professor_salaries: {upserted} rows upserted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
