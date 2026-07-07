"""
Dataset evaluation script for the CV / Job Matching dissertation project.

Reads two Kaggle CSVs (resumes + jobs), takes a small sample of each, and
calls the local FastAPI /match endpoint for every (CV, job) pair. The
endpoint already persists each result to Supabase, so this script does
NOT write to Supabase directly. It only collects the responses, prints a
useful per-pair summary, and saves a local CSV for dissertation evidence.

Run from the project root:
    source venv/bin/activate
    python scripts/run_dataset_evaluation.py
"""

import sys
import time
from pathlib import Path

import pandas as pd
import requests
from tqdm import tqdm


# ----- Config -----
PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESUMES_CSV = PROJECT_ROOT / "data" / "datasets" / "resumes.csv"
JOBS_CSV = PROJECT_ROOT / "data" / "datasets" / "jobs.csv"
OUTPUT_CSV = PROJECT_ROOT / "data" / "datasets" / "evaluation_results.csv"

BACKEND_URL = "http://127.0.0.1:8000"
HEALTH_ENDPOINT = f"{BACKEND_URL}/"
MATCH_ENDPOINT = f"{BACKEND_URL}/api/match"

MAX_RESUMES = 10
MAX_JOBS = 10
REQUEST_DELAY_SECONDS = 1
REQUEST_TIMEOUT_SECONDS = 60

# Candidate column names, in priority order.
RESUME_TEXT_COLS = ["Resume", "resume", "resume_text", "CV", "cv_text", "Text", "content"]
RESUME_ID_COLS = ["Category", "category", "label", "role", "job_category", "id", "ID"]
JOB_TITLE_COLS = ["Job Title", "job_title", "title", "position", "role"]
JOB_DESC_COLS = [
    "Job Description",
    "job_description",
    "description",
    "Description",
    "Job Description Text",
    "job_desc",
    "details",
]


def detect_column(columns, candidates):
    """Return the first candidate name that exists in `columns`, or None."""
    for name in candidates:
        if name in columns:
            return name
    return None


def check_files_exist():
    """Exit cleanly if either input CSV is missing."""
    missing = []
    if not RESUMES_CSV.exists():
        missing.append(RESUMES_CSV)
    if not JOBS_CSV.exists():
        missing.append(JOBS_CSV)
    if missing:
        print("[ERROR] Missing dataset file(s):")
        for path in missing:
            print(f"  - {path}")
        print("\nPlace your Kaggle CSVs at these paths and rerun:")
        print(f"  {RESUMES_CSV}")
        print(f"  {JOBS_CSV}")
        sys.exit(1)


def check_backend():
    """Exit cleanly if the FastAPI server is not reachable."""
    try:
        response = requests.get(HEALTH_ENDPOINT, timeout=5)
        response.raise_for_status()
    except Exception as exc:
        print(f"[ERROR] Backend not reachable at {HEALTH_ENDPOINT}: {exc}")
        print("Start FastAPI first, in another terminal:")
        print(f"  cd {PROJECT_ROOT}")
        print("  source venv/bin/activate")
        print("  uvicorn main:app --reload --port 8000")
        sys.exit(1)


def main():
    print("[1/5] Pre-flight: checking dataset files and backend...")
    check_files_exist()
    check_backend()
    print("  OK: dataset files found and backend is reachable")

    print("[2/5] Loading CSVs...")
    resumes = pd.read_csv(RESUMES_CSV)
    jobs = pd.read_csv(JOBS_CSV)
    print(f"  resumes.csv: {len(resumes)} rows")
    print(f"    columns: {list(resumes.columns)}")
    print(f"  jobs.csv: {len(jobs)} rows")
    print(f"    columns: {list(jobs.columns)}")

    resume_text_col = detect_column(resumes.columns, RESUME_TEXT_COLS)
    resume_id_col = detect_column(resumes.columns, RESUME_ID_COLS)
    job_title_col = detect_column(jobs.columns, JOB_TITLE_COLS)
    job_desc_col = detect_column(jobs.columns, JOB_DESC_COLS)

    print(f"  detected CV text column:        {resume_text_col}")
    print(f"  detected CV identifier column:  {resume_id_col}")
    print(f"  detected job title column:      {job_title_col}")
    print(f"  detected job description column:{job_desc_col}")

    errors = []
    if resume_text_col is None:
        errors.append(
            f"No CV text column in resumes.csv. Looked for: {RESUME_TEXT_COLS}. "
            f"Available columns: {list(resumes.columns)}"
        )
    if job_desc_col is None:
        errors.append(
            f"No job description column in jobs.csv. Looked for: {JOB_DESC_COLS}. "
            f"Available columns: {list(jobs.columns)}"
        )
    if errors:
        print("\n[ERROR] Required text columns missing:")
        for line in errors:
            print(f"  - {line}")
        sys.exit(1)

    print("[3/5] Sampling and pairing (cross-product)...")
    # fillna avoids NaN propagating into the request body.
    cv_sample = resumes.head(MAX_RESUMES).fillna("")
    job_sample = jobs.head(MAX_JOBS).fillna("")

    pairs = []
    for cv_idx, cv_row in cv_sample.iterrows():
        for job_idx, job_row in job_sample.iterrows():
            pairs.append((cv_idx, cv_row, job_idx, job_row))
    print(f"  total pairs: {len(pairs)} ({MAX_RESUMES} CVs x {MAX_JOBS} jobs)")

    print(f"[4/5] Calling {MATCH_ENDPOINT} for each pair...")
    results = []
    failures = 0

    for idx, (cv_idx, cv_row, job_idx, job_row) in enumerate(
        tqdm(pairs, desc="Evaluating", unit="pair")
    ):
        cv_text = str(cv_row[resume_text_col]).strip()
        job_description = str(job_row[job_desc_col]).strip()
        cv_identifier = (
            str(cv_row[resume_id_col]).strip() if resume_id_col else f"row_{cv_idx}"
        )
        job_title = (
            str(job_row[job_title_col]).strip() if job_title_col else f"row_{job_idx}"
        )

        # Skip rows where the dataset has empty/NaN text for either side.
        if not cv_text or not job_description:
            failures += 1
            print(
                f"  [SKIP] pair {idx + 1}/{len(pairs)} "
                f"cv={cv_identifier!r} job={job_title!r}: empty cv_text or job_description"
            )
            continue

        try:
            response = requests.post(
                MATCH_ENDPOINT,
                json={"cv_text": cv_text, "job_description": job_description},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            failures += 1
            print(
                f"  [FAIL] pair {idx + 1}/{len(pairs)} "
                f"cv={cv_identifier!r} job={job_title!r}: {exc}"
            )
            time.sleep(REQUEST_DELAY_SECONDS)
            continue

        # matching_skills and missing_skills live INSIDE explanation.
        explanation = data.get("explanation", {}) or {}
        matching_skills = explanation.get("matching_skills", []) or []
        missing_skills = explanation.get("missing_skills", []) or []
        short_explanation = explanation.get("short_explanation", "") or ""

        print(
            f"  [{idx + 1}/{len(pairs)}] "
            f"cv={cv_identifier} | job={job_title} | "
            f"sem={data.get('semantic_score')} "
            f"kw={data.get('keyword_score')} "
            f"final={data.get('final_score')} "
            f"level={data.get('match_level')!r} | "
            f"matched={matching_skills} | missing={missing_skills}"
        )

        results.append(
            {
                "cv_identifier": cv_identifier,
                "job_title": job_title,
                "semantic_score": data.get("semantic_score"),
                "keyword_score": data.get("keyword_score"),
                "final_score": data.get("final_score"),
                "match_level": data.get("match_level"),
                "matching_skills": matching_skills,
                "missing_skills": missing_skills,
                "short_explanation": short_explanation,
            }
        )

        time.sleep(REQUEST_DELAY_SECONDS)

    print("[5/5] Saving results and summary...")
    if results:
        results_df = pd.DataFrame(results)
        OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
        results_df.to_csv(OUTPUT_CSV, index=False)
        print(f"  results saved to {OUTPUT_CSV}")

        print("\n=== Summary ===")
        print(f"  successful evaluations: {len(results)}")
        print(f"  failed evaluations:     {failures}")
        print(f"  avg semantic_score: {results_df['semantic_score'].mean():.3f}")
        print(f"  avg keyword_score:  {results_df['keyword_score'].mean():.3f}")
        print(f"  avg final_score:    {results_df['final_score'].mean():.3f}")
        print("  match_level distribution:")
        for level, count in results_df["match_level"].value_counts().items():
            print(f"    {level}: {count}")
    else:
        print("  no successful results to save")
        print(f"  failed evaluations: {failures}")


if __name__ == "__main__":
    main()
