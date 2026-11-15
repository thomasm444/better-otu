"""Shared Supabase client, environment loading, and batching helpers."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar

from dotenv import load_dotenv
from supabase import Client, create_client

T = TypeVar("T")

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent
LOCAL_DIR = REPO_ROOT / "local"

DEFAULT_BATCH_SIZE = 500


def load_env() -> None:
    """Load .env files from python_scripts/, local/, and repo root without overriding OS env."""
    for env_path in (
        SCRIPTS_DIR / ".env",
        LOCAL_DIR / ".env",
        REPO_ROOT / ".env",
    ):
        if env_path.exists():
            load_dotenv(env_path, override=False)


def get_supabase() -> Client:
    """Create an authenticated Supabase service-role client."""
    load_env()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment / .env"
        )
    return create_client(url, key)


def batches(rows: list[T], size: int = DEFAULT_BATCH_SIZE) -> Iterator[list[T]]:
    """Yield slices of *rows* up to *size* items each."""
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()
