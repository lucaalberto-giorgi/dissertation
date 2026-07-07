# AI CV and Job Matching Dissertation Project

This project is a simple full-stack dissertation demo with:

- a FastAPI backend
- a React + Vite frontend
- CV-to-job matching using embeddings, keyword overlap, and explanation output
- optional PDF CV upload with text extraction
- saved match records using Supabase
- create, read and delete functionality for saved matches
- a Match History interface

The app accepts a CV and job description, then:

- anonymizes simple personal details from the CV
- computes a semantic similarity score using embeddings served through OpenRouter (default model: `openai/text-embedding-3-small`)
- computes a keyword-overlap score
- computes a final weighted score and match level
- generates a short explanation with matching and missing skills

## Live Demo

A hosted version of the app is available here:

[https://dissertation-hazel.vercel.app/?utm_source=portfolio](https://dissertation-hazel.vercel.app/?utm_source=portfolio)

> This deployment is for demonstration and testing purposes only. The system is a research prototype and is not intended for real recruitment decision-making.

## Preview

![AI CV Matcher demo screenshot](docs/images/ai-cv-matcher-demo.png)

## Project structure

```text
.
├── main.py           # FastAPI app (all endpoints under /api)
├── db.py             # Supabase helper for saved matches
├── api/index.py      # Vercel serverless entrypoint (imports main.app)
├── vercel.json       # Routes /api/* to the Python function
├── requirements.txt  # Backend dependencies
├── scripts/          # Offline dataset evaluation (own requirements.txt)
├── package.json
├── index.html
├── src/              # React frontend
├── .env.example
└── README.md
```

## 1. Backend setup

Create and activate a virtual environment if you want:

```bash
python3 -m venv venv
source venv/bin/activate
```

Then install the required packages:

```bash
pip install -r requirements.txt
```

## 2. Create and use `.env`

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` and add your OpenRouter API key (create one at https://openrouter.ai/keys) plus the Supabase credentials:

```env
OPENROUTER_API_KEY=your_real_api_key_here
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your_service_role_key
```

Do not commit your real `.env` file or API key.

## 3. Run the backend

Start the FastAPI app with Uvicorn:

```bash
uvicorn main:app --reload
```

The API will be available at:

- `http://127.0.0.1:8000`
- Swagger docs: `http://127.0.0.1:8000/docs`

## 4. Frontend setup

Install the frontend dependencies:

```bash
npm install
```

Start the React development server:

```bash
npm run dev
```

The frontend will usually run at:

- `http://localhost:5173`

## 5. Test the `/api/match` endpoint

You can test it in Swagger UI or with `curl`.

Example request:

```bash
curl -X POST "http://127.0.0.1:8000/api/match" \
  -H "Content-Type: application/json" \
  -d '{
    "cv_text": "Mr John Smith is a Python developer with experience in FastAPI, APIs, NumPy, and machine learning. Email: john@example.com Phone: +44 7700 900123",
    "job_description": "We are hiring a Python developer with FastAPI experience, strong API design skills, NumPy knowledge, and machine learning exposure."
  }'
```

Example response shape:

```json
{
  "semantic_score": 0.912,
  "keyword_score": 0.667,
  "final_score": 0.838,
  "match_level": "Strong match",
  "score_interpretation": "The candidate appears to align well with the job because both the overall meaning and the key terms are strongly related.",
  "explanation": {
    "matching_skills": [
      "Python",
      "FastAPI",
      "NumPy",
      "machine learning"
    ],
    "missing_skills": [],
    "short_explanation": "The CV aligns well with the main technical requirements in the job description."
  },
  "anonymized_cv": "John Smith is a Python developer with experience in FastAPI, APIs, NumPy, and machine learning. Email: [EMAIL] Phone: [PHONE]"
}
```

## 6. Test PDF CV upload

The backend includes a dedicated PDF extraction endpoint:

- `POST /api/extract-cv-pdf`

You can test it in Swagger UI or with `curl`:

```bash
curl -X POST "http://127.0.0.1:8000/api/extract-cv-pdf" \
  -F "file=@/absolute/path/to/cv.pdf"
```

Example response shape:

```json
{
  "extracted_text": "Extracted CV text goes here...",
  "filename": "cv.pdf"
}
```

In the frontend:

1. Open `http://localhost:5173`
2. Upload a PDF CV using the file input
3. Wait for the success message
4. Confirm that the extracted text appears in the CV textarea
5. Add a job description
6. Click `Match`

If no PDF is uploaded, you can continue using the manual CV textarea as before.

## Deployment

The whole app is deployed as a single Vercel project:

- The Vite frontend is built as static files and served from the site root.
- The FastAPI backend runs as a Vercel Python serverless function. `vercel.json` rewrites every `/api/*` request to `api/index.py`, which imports the app from `main.py`.
- Because frontend and API share one domain, no `VITE_API_URL` or CORS configuration is needed in production.

Required environment variables in the Vercel project settings (Production and Preview):

- `OPENROUTER_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_KEY`

Every pull request gets a preview deployment with its own working API, so changes can be tested end to end before they reach production.

## Notes

- This is an MVP for a dissertation demo, so the anonymization, PDF extraction, and scoring are intentionally simple.
- PDF extraction works best on standard text-based CV PDFs. Scanned image-only PDFs may not return useful text.
- The project uses Supabase as a PostgreSQL database to store saved CV–job match records. All database operations are handled through the FastAPI backend; the frontend does not access Supabase directly. Supabase and OpenRouter secrets are kept server-side through environment variables.
- Embeddings are requested through OpenRouter's OpenAI-compatible API. The default model (`openai/text-embedding-3-small`) matches the one used for the dissertation evaluation results; set `EMBEDDING_MODEL` to experiment with other models, but note that all scores change and the evaluation should be re-run.
- If the embedding request fails, the backend returns a `502` error with a short message.
