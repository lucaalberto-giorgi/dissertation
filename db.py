"""
Supabase database helper for the CV Job Matcher.

This module is intentionally isolated from main.py so the existing
/match endpoint stays untouched until you decide to wire it in.
Uses the supabase Python client (no ORM, no raw SQL strings).
"""

import os
import traceback
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client, Client


# Load SUPABASE_URL and SUPABASE_KEY from the local .env file.
# SUPABASE_URL  -> https://<your-project-ref>.supabase.co
# SUPABASE_KEY  -> the service_role key (server-side only) OR the anon key
#                  if you have RLS policies that allow inserts.
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_KEY must be set in your .env file."
    )


# A single shared client is enough for an MVP. The supabase client
# manages its own HTTP session internally, so we create it once at
# module import time and reuse it for every insert.
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# Name of the table that stores match results.
# The live Supabase schema uses a UUID primary key (Supabase default).
# Equivalent SQL:
#
#   create table matches (
#       id                   uuid primary key default gen_random_uuid(),
#       created_at           timestamptz default now(),
#       cv_text              text,
#       job_description      text,
#       anonymized_cv        text,
#       semantic_score       numeric,
#       keyword_score        numeric,
#       final_score          numeric,
#       match_level          text,
#       score_interpretation text,
#       matching_skills      jsonb,
#       missing_skills       jsonb,
#       short_explanation    text
#   );
MATCHES_TABLE = "matches"


def save_match_record(
    cv_text: str,
    job_description: str,
    anonymized_cv: str,
    semantic_score: float,
    keyword_score: float,
    final_score: float,
    match_level: str,
    score_interpretation: str,
    matching_skills: list[str],
    missing_skills: list[str],
    short_explanation: str,
) -> Optional[dict]:
    """
    Insert a single match result into the `matches` table.

    Returns the inserted row as a dict on success, or None on failure.
    Errors are logged and swallowed on purpose: a database outage
    should not break the user-facing scoring response, so the caller
    (the /match endpoint) can still return a normal MatchResponse.
    """
    print("[DB DEBUG] save_match_record started")
    # Build the row exactly as the table expects it. The supabase
    # client serializes Python lists into the jsonb columns for us.
    record = {
        "cv_text": cv_text,
        "job_description": job_description,
        "anonymized_cv": anonymized_cv,
        "semantic_score": semantic_score,
        "keyword_score": keyword_score,
        "final_score": final_score,
        "match_level": match_level,
        "score_interpretation": score_interpretation,
        "matching_skills": matching_skills,
        "missing_skills": missing_skills,
        "short_explanation": short_explanation,
    }

    try:
        response = supabase.table(MATCHES_TABLE).insert(record).execute()
    except Exception as exc:
        # Log and continue. The /match endpoint stays functional even
        # if Supabase is unreachable or the schema is misconfigured.
        print(f"[DB DEBUG] Failed to save match record: {exc}")
        print(f"[DB DEBUG] Full traceback:\n{traceback.format_exc()}")
        return None

    # The supabase-py response exposes inserted rows on `.data`.
    inserted_rows = getattr(response, "data", None) or []
    if not inserted_rows:
        print("[DB DEBUG] Insert returned no rows.")
        return None

    inserted_id = inserted_rows[0].get("id")
    print(f"[DB DEBUG] Match record saved successfully — id={inserted_id}")
    print(f"[DB DEBUG] Supabase insert response: {response.data}")
    return inserted_rows[0]


# Columns returned to the frontend by GET /matches.
# Intentionally excludes cv_text and job_description so that the full
# original CV / job text is never sent back to the browser.
SAFE_LIST_COLUMNS = (
    "id, created_at, semantic_score, keyword_score, final_score, "
    "match_level, matching_skills, missing_skills, short_explanation"
)


def list_match_records(limit: int = 50) -> list[dict]:
    """
    Read the most recent match records from the `matches` table.

    Only safe columns are returned (no cv_text, no job_description).
    Errors are logged and swallowed: the endpoint receives an empty
    list rather than an exception, so the frontend can still render.
    """
    print(f"[DB DEBUG] list_match_records started (limit={limit})")
    try:
        response = (
            supabase.table(MATCHES_TABLE)
            .select(SAFE_LIST_COLUMNS)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        print(f"[DB DEBUG] Failed to list match records: {exc}")
        print(f"[DB DEBUG] Full traceback:\n{traceback.format_exc()}")
        return []

    rows = getattr(response, "data", None) or []
    print(f"[DB DEBUG] list_match_records returned {len(rows)} rows")
    return rows


def delete_match_record(record_id: str) -> bool:
    """
    Delete a single match record by primary key.

    The `id` column is a UUID in Supabase, so the record_id is passed
    as a string. Returns True if a row was deleted, False if no row
    matched the id or the database operation failed. Errors are logged
    and swallowed so the endpoint can convert them into a clean HTTP
    response.
    """
    print(f"[DB DEBUG] delete_match_record started (id={record_id})")
    try:
        response = (
            supabase.table(MATCHES_TABLE)
            .delete()
            .eq("id", record_id)
            .execute()
        )
    except Exception as exc:
        print(f"[DB DEBUG] Failed to delete match record: {exc}")
        print(f"[DB DEBUG] Full traceback:\n{traceback.format_exc()}")
        return False

    deleted_rows = getattr(response, "data", None) or []
    if not deleted_rows:
        print(f"[DB DEBUG] No match record found with id={record_id}")
        return False

    print(f"[DB DEBUG] Match record deleted successfully — id={record_id}")
    return True
