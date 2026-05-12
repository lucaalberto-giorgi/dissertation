import os
import re
from io import BytesIO
from typing import List

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from openai import OpenAI
from pypdf import PdfReader
from pydantic import BaseModel, Field

from db import (
    delete_match_record,
    list_match_records,
    save_match_record,
)


# Load values from the local .env file.
load_dotenv()


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBEDDING_MODEL = "text-embedding-3-small"
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing. Add it to your .env file.")


client = OpenAI(api_key=OPENAI_API_KEY)
app = FastAPI(title="CV Job Matcher API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://dissertation-mt2blt6gd-luca-alberto-giorgis-projects.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class MatchRequest(BaseModel):
    cv_text: str = Field(..., description="Raw CV text")
    job_description: str = Field(..., description="Raw job description text")


class ExplanationResponse(BaseModel):
    matching_skills: list[str]
    missing_skills: list[str]
    short_explanation: str


class MatchResponse(BaseModel):
    semantic_score: float
    keyword_score: float
    final_score: float
    match_level: str
    score_interpretation: str
    explanation: ExplanationResponse
    anonymized_cv: str


class SavedMatchResponse(BaseModel):
    """
    Trimmed representation of a saved match record.

    cv_text and job_description are intentionally excluded from this
    model: the original CV and job description are never returned to
    the frontend by the listing endpoint.
    """

    id: str
    created_at: str | None = None
    semantic_score: float | None = None
    keyword_score: float | None = None
    final_score: float | None = None
    match_level: str | None = None
    matching_skills: list[str] = []
    missing_skills: list[str] = []
    short_explanation: str | None = None


TECHNICAL_SKILLS = [
    "python",
    "fastapi",
    "flask",
    "rest api",
    "machine learning",
    "pandas",
    "numpy",
    "docker",
    "aws",
    "postgresql",
    "git",
]

SKILL_ALIASES = {
    "python": ["python"],
    "fastapi": ["fastapi", "fast api"],
    "flask": ["flask"],
    "rest api": ["rest api", "restful api", "rest apis"],
    "machine learning": ["machine learning", "ml"],
    "pandas": ["pandas"],
    "numpy": ["numpy"],
    "docker": ["docker"],
    "aws": ["aws"],
    "postgresql": ["postgresql", "postgres"],
    "git": ["git"],
}

EQUIVALENT_SKILL_GROUPS = [
    {"fastapi", "flask"},
]


def anonymize_cv_text(cv_text: str) -> str:
    """
    Remove a few simple personal identifiers from the CV text.
    This is intentionally basic for the MVP.
    """
    text = re.sub(r"\b(Mr|Mrs|Ms)\.?\s+", "", cv_text, flags=re.IGNORECASE)
    text = re.sub(r"\b[\w\.-]+@[\w\.-]+\.\w+\b", "[EMAIL]", text)
    text = re.sub(
        r"(\+?\d[\d\-\s\(\)]{7,}\d)",
        "[PHONE]",
        text,
    )
    return text


def normalize_text(text: str) -> str:
    """
    Lowercase the text, remove punctuation, and clean spacing.
    This keeps the normalization simple and avoids replacing too much.
    """
    text = text.lower()
    text = re.sub(r"\b(?:[a-z]\s+){2,}[a-z]\b", lambda match: match.group(0).replace(" ", ""), text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_skills_from_text(text: str) -> list[str]:
    """
    Detect relevant technical skills using a predefined skill list and
    simple substring matching on normalized text.
    """
    normalized_text = f" {normalize_text(text)} "
    detected_skills = []

    for skill in TECHNICAL_SKILLS:
        aliases = SKILL_ALIASES.get(skill, [skill])
        if any(f" {alias} " in normalized_text for alias in aliases):
            detected_skills.append(skill)

    return detected_skills


def has_equivalent_skill(skill: str, detected_skills: list[str]) -> bool:
    """
    Allow a small amount of flexibility for closely related frameworks.
    This keeps the matching logic simple while avoiding overly harsh
    penalties when equivalent backend frameworks are present.
    """
    for group in EQUIVALENT_SKILL_GROUPS:
        if skill in group and any(candidate in group for candidate in detected_skills):
            return True
    return False


def analyze_skill_match(
    normalized_cv_text: str,
    normalized_job_text: str,
) -> tuple[list[str], list[str], list[str]]:
    """
    Run the skill detection once and reuse the result for both keyword
    scoring and explanation generation.
    """
    cv_skills = extract_skills_from_text(normalized_cv_text)
    required_skills = extract_skills_from_text(normalized_job_text)

    print(f"[SKILL DEBUG] Processed CV text: {normalized_cv_text}")
    print(f"[SKILL DEBUG] Processed job description: {normalized_job_text}")
    print(f"[SKILL DEBUG] Detected CV skills: {cv_skills}")
    print(f"[SKILL DEBUG] Detected job skills: {required_skills}")

    if not cv_skills:
        print("[SKILL DEBUG] No CV skills were detected from the predefined skill list.")
    if not required_skills:
        print("[SKILL DEBUG] No job skills were detected from the predefined skill list.")

    matching_skills = []
    missing_skills = []

    for skill in required_skills:
        if skill in cv_skills or has_equivalent_skill(skill, cv_skills):
            matching_skills.append(skill)
        else:
            missing_skills.append(skill)

    print(f"[SKILL DEBUG] Matching skills: {matching_skills}")
    print(f"[SKILL DEBUG] Missing skills: {missing_skills}")

    return cv_skills, matching_skills, missing_skills


def find_matching_and_missing_skills(
    cv_text: str,
    job_description: str,
) -> tuple[list[str], list[str]]:
    """
    Compare detected technical skills in the CV against the technical
    skills required by the job description.
    """
    processed_cv_text = normalize_text(cv_text)
    processed_job_text = normalize_text(job_description)
    _, matching_skills, missing_skills = analyze_skill_match(
        processed_cv_text,
        processed_job_text,
    )
    return matching_skills, missing_skills


def calculate_keyword_score(cv_text: str, job_description: str) -> float:
    """
    Score based on how many required technical skills from the job
    description are also present in the CV.
    """
    normalized_cv_text = normalize_text(cv_text)
    normalized_job_text = normalize_text(job_description)
    required_skills = extract_skills_from_text(normalized_job_text)
    if not required_skills:
        return 0.0

    _, matching_skills, _ = analyze_skill_match(
        normalized_cv_text,
        normalized_job_text,
    )
    keyword_score = len(matching_skills) / len(required_skills)
    return round(keyword_score, 3)


def get_embedding(text: str) -> List[float]:
    """Request a single embedding vector from OpenAI."""
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding


def cosine_similarity(vector_a: List[float], vector_b: List[float]) -> float:
    """Compute cosine similarity between two embedding vectors."""
    a = np.array(vector_a)
    b = np.array(vector_b)

    denominator = np.linalg.norm(a) * np.linalg.norm(b)
    if denominator == 0:
        return 0.0

    similarity = float(np.dot(a, b) / denominator)
    return round(similarity, 3)


def calibrate_semantic_score(raw_similarity: float) -> float:
    """
    Normalize cosine similarity from the standard -1 to 1 range into
    a 0 to 1 range using a simple dissertation-friendly formula.
    """
    calibrated_score = (raw_similarity + 1) / 2
    calibrated_score = max(0.0, min(calibrated_score, 1.0))
    return round(calibrated_score, 3)


def calculate_final_score(
    semantic_score: float,
    keyword_score: float,
    missing_skills: list[str],
) -> float:
    """
    Combine the two scores using a simple weighted average.
    Semantic similarity has a higher weight because it captures the
    overall meaning of the CV and job description.
    A small bonus is added when no missing skills are identified.
    If no missing skills are detected, the final score should still
    reflect a strong match in a simple and explainable way.
    """
    no_missing_skills_bonus = 0.05 if not missing_skills else 0.0
    final_score = (
        (semantic_score * 0.7)
        + (keyword_score * 0.3)
        + no_missing_skills_bonus
    )
    if not missing_skills:
        final_score = max(final_score, 0.75)
    final_score = min(final_score, 1.0)
    return round(final_score, 3)


def get_match_level(final_score: float, matching_skills: list[str]) -> str:
    """
    Convert the final score into a simple label that is easy to explain
    in a dissertation project.
    """
    if not matching_skills:
        return "Weak match"

    if final_score >= 0.75:
        return "Strong match"
    if final_score >= 0.6:
        return "Moderate match"
    return "Weak match"


def get_score_interpretation(final_score: float) -> str:
    """
    Provide a short interpretation of the final score.
    This keeps the scoring logic transparent and beginner-friendly.
    """
    if final_score >= 0.75:
        return (
            "The candidate appears to align well with the job because both "
            "the overall meaning and the key terms are strongly related."
        )
    if final_score >= 0.5:
        return (
            "The candidate shows partial alignment with the job, but there "
            "are some important gaps in skills or experience."
        )
    return (
        "The candidate currently has limited alignment with the job, which "
        "suggests several important requirements are missing."
    )


def build_short_explanation(
    matching_skills: list[str],
    missing_skills: list[str],
) -> str:
    """
    Build a simple deterministic explanation from the current skill
    matching result.
    """
    if matching_skills and not missing_skills:
        return (
            "The CV covers the main skills requested in the job description."
        )
    if matching_skills:
        return (
            "The CV matches several important job skills, but some requested "
            "skills are still missing."
        )
    return "The CV shows limited keyword overlap with the job description."


def extract_text_from_pdf_bytes(file_bytes: bytes) -> str:
    """
    Extract plain text from a standard PDF file.
    The extracted text is joined page by page and cleaned before use.
    """
    try:
        pdf_reader = PdfReader(BytesIO(file_bytes))
    except Exception as exc:
        print(f"[PDF DEBUG] PDF read failure: {str(exc)}")
        raise HTTPException(
            status_code=400,
            detail=f"PDF read failure: {str(exc)}",
        )

    print(f"[PDF DEBUG] PDF opened successfully. Total pages: {len(pdf_reader.pages)}")

    page_text = []
    for page_index, page in enumerate(pdf_reader.pages, start=1):
        extracted_page_text = page.extract_text() or ""
        print(
            "[PDF DEBUG] Page "
            f"{page_index} extracted characters: {len(extracted_page_text.strip())}"
        )
        if extracted_page_text.strip():
            page_text.append(extracted_page_text.strip())

    extracted_text = normalize_text("\n\n".join(page_text))
    print(f"[PDF DEBUG] Total extracted text length: {len(extracted_text)}")

    if not extracted_text:
        raise HTTPException(
            status_code=400,
            detail=(
                "The uploaded PDF did not contain any readable text. "
                "Please try a standard text-based PDF rather than a scanned image."
            ),
        )

    return extracted_text


@app.get("/")
def read_root() -> dict:
    return {"message": "CV Job Matcher API is running"}


@app.post("/extract-cv-pdf")
async def extract_cv_pdf(file: UploadFile = File(...)) -> JSONResponse:
    """
    Accept a PDF CV upload and return the extracted text.
    This keeps file handling separate from the existing matching flow.
    """
    if not file.filename:
        print("[PDF DEBUG] No filename received in upload.")
        return JSONResponse(
            status_code=400,
            content={"error": "No file uploaded.", "detail": "No file uploaded."},
        )

    print(
        "[PDF DEBUG] Upload received. "
        f"Filename: {file.filename}, Content-Type: {file.content_type}"
    )

    if not file.filename.lower().endswith(".pdf"):
        print(f"[PDF DEBUG] Rejected non-PDF file: {file.filename}")
        return JSONResponse(
            status_code=400,
            content={
                "error": "Only PDF files are supported.",
                "detail": "Only PDF files are supported.",
            },
        )

    try:
        file_bytes = await file.read()
    finally:
        await file.close()

    if not file_bytes:
        print(f"[PDF DEBUG] Uploaded file is empty: {file.filename}")
        return JSONResponse(
            status_code=400,
            content={
                "error": "The uploaded file is empty.",
                "detail": "The uploaded file is empty.",
            },
        )

    print(
        "[PDF DEBUG] File bytes received successfully. "
        f"Filename: {file.filename}, Size: {len(file_bytes)} bytes"
    )

    try:
        extracted_text = extract_text_from_pdf_bytes(file_bytes)
    except HTTPException as exc:
        message = str(exc.detail)
        if "did not contain any readable text" in message:
            print("[PDF DEBUG] No text extracted from PDF.")
            return JSONResponse(
                status_code=400,
                content={
                    "error": "No text extracted from PDF",
                    "detail": "No text extracted from PDF",
                },
            )

        print(f"[PDF DEBUG] Extraction failed: {message}")
        return JSONResponse(
            status_code=400,
            content={"error": message, "detail": message},
        )
    except Exception as exc:
        print(f"[PDF DEBUG] Unexpected extraction failure: {str(exc)}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "Unexpected PDF extraction failure",
                "detail": "Unexpected PDF extraction failure",
            },
        )

    print(
        "[PDF DEBUG] Extraction succeeded. "
        f"Filename: {file.filename}, Extracted length: {len(extracted_text)}"
    )
    return JSONResponse(
        content={
            "cv_text": extracted_text,
            "extracted_text": extracted_text,
            "filename": file.filename,
        }
    )


@app.post("/match", response_model=MatchResponse)
def match_cv_to_job(payload: MatchRequest) -> MatchResponse:
    cv_text = payload.cv_text.strip()
    job_description = payload.job_description.strip()

    if not cv_text or not job_description:
        raise HTTPException(
            status_code=400,
            detail="cv_text and job_description must not be empty.",
        )

    anonymized_cv = anonymize_cv_text(cv_text)
    normalized_cv_text = normalize_text(anonymized_cv)
    normalized_job_text = normalize_text(job_description)

    try:
        cv_embedding = get_embedding(normalized_cv_text)
        job_embedding = get_embedding(normalized_job_text)

        raw_semantic_score = cosine_similarity(cv_embedding, job_embedding)
        semantic_score = calibrate_semantic_score(raw_semantic_score)
        _, matching_skills, missing_skills = analyze_skill_match(
            normalized_cv_text,
            normalized_job_text,
        )
        required_skills = extract_skills_from_text(normalized_job_text)
        keyword_score = (
            round(len(matching_skills) / len(required_skills), 3)
            if required_skills
            else 0.0
        )
        explanation = ExplanationResponse(
            matching_skills=matching_skills,
            missing_skills=missing_skills,
            short_explanation=build_short_explanation(
                matching_skills,
                missing_skills,
            ),
        )
        final_score = calculate_final_score(
            semantic_score,
            keyword_score,
            explanation.missing_skills,
        )
        match_level = get_match_level(
            final_score,
            explanation.matching_skills,
        )
        score_interpretation = get_score_interpretation(final_score)

        # Persist the match result. save_match_record swallows its own
        # errors and returns None on failure, so the response below is
        # always returned even if the database is unavailable.
        print("[DB DEBUG] Calling save_match_record")
        save_match_record(
            cv_text=cv_text,
            job_description=job_description,
            anonymized_cv=anonymized_cv,
            semantic_score=semantic_score,
            keyword_score=keyword_score,
            final_score=final_score,
            match_level=match_level,
            score_interpretation=score_interpretation,
            matching_skills=explanation.matching_skills,
            missing_skills=explanation.missing_skills,
            short_explanation=explanation.short_explanation,
        )

        return MatchResponse(
            semantic_score=semantic_score,
            keyword_score=keyword_score,
            final_score=final_score,
            match_level=match_level,
            score_interpretation=score_interpretation,
            explanation=explanation,
            anonymized_cv=anonymized_cv,
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail="The explanation response could not be parsed as JSON.",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI API request failed: {str(exc)}",
        )


@app.get("/matches", response_model=list[SavedMatchResponse])
def get_saved_matches(limit: int = 50) -> list[SavedMatchResponse]:
    """
    Return the most recent saved match records (newest first).

    The response excludes the full CV text and the full job description
    on purpose, so neither value is exposed to the frontend.
    """
    safe_limit = max(1, min(limit, 100))
    rows = list_match_records(limit=safe_limit)

    saved_matches: list[SavedMatchResponse] = []
    for row in rows:
        saved_matches.append(
            SavedMatchResponse(
                id=str(row.get("id")) if row.get("id") is not None else "",
                created_at=(
                    str(row["created_at"])
                    if row.get("created_at") is not None
                    else None
                ),
                semantic_score=row.get("semantic_score"),
                keyword_score=row.get("keyword_score"),
                final_score=row.get("final_score"),
                match_level=row.get("match_level"),
                matching_skills=row.get("matching_skills") or [],
                missing_skills=row.get("missing_skills") or [],
                short_explanation=row.get("short_explanation"),
            )
        )
    return saved_matches


@app.delete("/matches/{record_id}", status_code=204)
def delete_saved_match(record_id: str) -> Response:
    """
    Delete a single saved match record by primary key.

    Returns 204 on success, 404 if the record does not exist, and 502
    if the database operation fails. The /match endpoint is unaffected.
    """
    try:
        was_deleted = delete_match_record(record_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to delete match record: {str(exc)}",
        )

    if not was_deleted:
        raise HTTPException(
            status_code=404,
            detail=f"No match record found with id={record_id}",
        )

    # 204 No Content must have an empty body. JSONResponse(content=None)
    # serializes to the 4-byte literal "null", which violates RFC 7230
    # for 204 responses and causes Starlette to log an ASGI exception
    # after the response is sent. A bare Response with no body is the
    # correct shape here.
    return Response(status_code=204)
