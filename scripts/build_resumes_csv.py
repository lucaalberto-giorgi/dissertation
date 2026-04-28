"""
One-off helper: extract plain text from a folder of .docx resumes and
write a single CSV that the evaluation script can consume.

Output schema:
    id      -> filename without extension
    Resume  -> extracted plain text

Run from the project root:
    source venv/bin/activate
    python scripts/build_resumes_csv.py
"""

import sys
from pathlib import Path

import pandas as pd
from docx import Document


# Source folder of .docx resumes (Kaggle download).
SOURCE_DIR = Path("/Users/lucaalbertogiorgi/Desktop/kaggle/Resumes")

# Destination CSV inside the project.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_CSV = PROJECT_ROOT / "data" / "datasets" / "resumes.csv"


def extract_text(docx_path: Path) -> str:
    """Read a .docx file and return its plain text (paragraphs joined by newline)."""
    document = Document(str(docx_path))
    paragraphs = [p.text for p in document.paragraphs if p.text and p.text.strip()]
    return "\n".join(paragraphs).strip()


def main():
    if not SOURCE_DIR.exists():
        print(f"[ERROR] Source folder not found: {SOURCE_DIR}")
        sys.exit(1)

    docx_files = sorted(
        list(SOURCE_DIR.glob("*.docx")) + list(SOURCE_DIR.glob("*.DOCX"))
    )
    print(f"Found {len(docx_files)} .docx files in {SOURCE_DIR}")

    rows = []
    skipped_empty = 0
    skipped_error = 0

    for path in docx_files:
        try:
            text = extract_text(path)
        except Exception as exc:
            skipped_error += 1
            print(f"  [ERROR] Could not read {path.name}: {exc}")
            continue

        if not text:
            skipped_empty += 1
            continue

        rows.append({"id": path.stem, "Resume": text})

    if not rows:
        print("[ERROR] No resumes extracted — output CSV not written.")
        sys.exit(1)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(OUTPUT_CSV, index=False)

    print(f"Extracted: {len(rows)} resumes")
    print(f"Skipped (empty): {skipped_empty}")
    print(f"Skipped (read error): {skipped_error}")
    print(f"Wrote: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
