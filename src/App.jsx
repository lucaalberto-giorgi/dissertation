import { useEffect, useRef, useState } from "react";

// Empty base URL means same-origin requests: /api/* is served by the
// Vercel Python function in production and proxied to the local FastAPI
// server by Vite in development (see vite.config.js). VITE_API_URL stays
// as an escape hatch for pointing at a separately hosted backend.
const API_BASE_URL = import.meta.env.VITE_API_URL || "";

function formatSavedDate(rawDate) {
  if (!rawDate) {
    return "Unknown date";
  }

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) {
    return rawDate;
  }

  return parsed.toLocaleString();
}

const initialResult = null;

// One-click demo data so a visitor can try the app without hunting for
// a CV and job description. Crafted to produce a strong-but-imperfect
// match, so the report shows both matched and missing skills.
const SAMPLE_CV = `Jordan Reyes — Backend Engineer

Five years building production systems in Python. Designed REST APIs with FastAPI and Flask serving 40M requests a month, containerised with Docker and deployed on AWS (ECS, Lambda, S3). Modelled and tuned data in PostgreSQL, built NumPy-based analytics pipelines, and shipped two machine-learning-powered features end to end. Comfortable with Git-driven CI/CD workflows, API design reviews, and mentoring junior engineers.`;

const SAMPLE_JOB = `Senior Backend Engineer — Platform Team

We are hiring a Python engineer to build REST APIs with FastAPI, run services on AWS with Docker, and own our PostgreSQL data layer. You will collaborate through Git and code reviews with a small product-focused team. Experience with pandas for internal analytics and prior machine learning exposure are strong pluses.`;

function formatScore(score) {
  if (typeof score !== "number") {
    return "N/A";
  }

  return `${(score * 100).toFixed(1)}%`;
}

function getScoreWidth(score) {
  if (typeof score !== "number") {
    return "0%";
  }

  return `${Math.max(0, Math.min(score * 100, 100))}%`;
}

function levelTone(matchLevel) {
  if (matchLevel === "Strong match") {
    return "level-strong";
  }
  if (matchLevel === "Moderate match") {
    return "level-moderate";
  }
  if (matchLevel === "Weak match") {
    return "level-weak";
  }
  return "level-unknown";
}

function buildRecommendation(result) {
  const missingSkills = result?.explanation?.missing_skills || [];

  if (missingSkills.length > 0) {
    return `To improve this match, the candidate should strengthen or highlight these areas: ${missingSkills.join(
      ", "
    )}.`;
  }

  if (result?.match_level === "Strong match") {
    return "The candidate already aligns well with this role. A stronger application could focus on clearer evidence of impact and relevant achievements.";
  }

  return "The candidate should make the CV more targeted by emphasizing job-relevant skills, tools, and examples of experience.";
}

// Minimum words before a document can be filed — filters out empty or
// throwaway input without getting in the way of real documents.
const MIN_WORDS_TO_FILE = 8;

function countWords(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function hasMeaningfulContent(text) {
  return countWords(text) >= MIN_WORDS_TO_FILE;
}

function WordCount({ text }) {
  const words = countWords(text);
  const short = words < MIN_WORDS_TO_FILE;

  return (
    <span className={`word-count ${short ? "word-count-short" : ""}`}>
      {words} {words === 1 ? "word" : "words"}
      {short ? ` — ${MIN_WORDS_TO_FILE} needed to file` : ""}
    </span>
  );
}

function buildPreviewText(text) {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return "No content added yet.";
  }

  const previewLines = trimmedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);

  return previewLines.join(" ").slice(0, 180);
}

function toTitleCase(text) {
  return text.replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractSummaryTags(text, type) {
  const normalizedText = text.toLowerCase();
  const tags = [];
  const tagRules =
    type === "cv"
      ? [
          { label: "Backend Developer", matches: ["backend", "api", "fastapi", "flask"] },
          { label: "Python", matches: ["python"] },
          { label: "APIs", matches: ["api", "apis", "rest api", "restful api"] },
          { label: "Machine Learning", matches: ["machine learning", "ml"] },
          { label: "Docker", matches: ["docker"] },
          { label: "AWS", matches: ["aws"] },
          { label: "PostgreSQL", matches: ["postgresql", "postgres"] },
        ]
      : [
          { label: "Backend Role", matches: ["backend", "api", "fastapi", "flask"] },
          { label: "Python", matches: ["python"] },
          { label: "AWS", matches: ["aws"] },
          { label: "Docker", matches: ["docker"] },
          { label: "Machine Learning", matches: ["machine learning", "ml"] },
          { label: "PostgreSQL", matches: ["postgresql", "postgres"] },
          { label: "REST APIs", matches: ["rest api", "restful api", "rest apis", "api"] },
        ];

  for (const rule of tagRules) {
    if (rule.matches.some((match) => normalizedText.includes(match))) {
      tags.push(rule.label);
    }
  }

  if (tags.length >= 2) {
    return tags.slice(0, 4);
  }

  const fallbackWords = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4)
    .filter((word) => !["experience", "working", "skills", "responsibilities"].includes(word));

  for (const word of fallbackWords) {
    const label = toTitleCase(word);
    if (!tags.includes(label)) {
      tags.push(label);
    }
    if (tags.length === 4) {
      break;
    }
  }

  return tags.slice(0, 4);
}

function LedgerScore({ label, score, tone }) {
  return (
    <div className="ledger-item">
      <div className="ledger-item-head">
        <span className="ledger-label">{label}</span>
        <span className="ledger-leader" />
        <span className="ledger-value">{formatScore(score)}</span>
      </div>
      <div className="ledger-track">
        <div
          className={`ledger-fill ${tone === "accent" ? "tone-accent" : ""}`}
          style={{ width: getScoreWidth(score) }}
        />
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return <span className="loading-spinner" aria-hidden="true" />;
}

function InputPreviewCard({ title, text, type, onEdit }) {
  const summaryTags = extractSummaryTags(text, type);

  return (
    <div className="doc-logged">
      <div className="doc-logged-head">
        <div>
          <p className="doc-logged-status">{title} on file ✓</p>
          <span className="doc-logged-words">{countWords(text)} words</span>
        </div>
        <button className="btn-ghost" type="button" onClick={onEdit}>
          Edit
        </button>
      </div>
      {summaryTags.length ? (
        <div className="doc-tag-group">
          {summaryTags.map((tag) => (
            <span className="doc-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <p className="doc-logged-text">{buildPreviewText(text)}</p>
    </div>
  );
}

function FolioHead({ no, title, aside }) {
  return (
    <div className="folio-head">
      <span className="folio-no">{no}</span>
      <h2 className="folio-title">{title}</h2>
      <span className="folio-line" role="presentation" />
      {aside ? <span className="folio-aside">{aside}</span> : null}
    </div>
  );
}

function App() {
  const [cvText, setCvText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [cvPreviewMode, setCvPreviewMode] = useState(false);
  const [jobPreviewMode, setJobPreviewMode] = useState(false);
  // The ledger only shows matches run in THIS visitor's session — the
  // database keeps everything server-side, but nobody sees (or can
  // delete) anyone else's runs. sessionStorage survives a page refresh.
  const [sessionMatches, setSessionMatches] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("sessionMatches") || "[]");
    } catch {
      return [];
    }
  });
  const [ledgerError, setLedgerError] = useState("");
  const [deletingMatchId, setDeletingMatchId] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const reportRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem("sessionMatches", JSON.stringify(sessionMatches));
    } catch {
      // Storage full or unavailable — the ledger just won't survive refresh.
    }
  }, [sessionMatches]);
  const canRunMatch =
    Boolean(cvText.trim()) &&
    Boolean(jobDescription.trim()) &&
    !loading &&
    !uploadingPdf;

  function requestDeleteMatch(matchId) {
    if (matchId === null || matchId === undefined || matchId === "") {
      return;
    }
    setPendingDeleteId(matchId);
  }

  function cancelDeleteMatch() {
    if (deletingMatchId !== null) {
      return;
    }
    setPendingDeleteId(null);
  }

  async function confirmDeleteMatch() {
    const matchId = pendingDeleteId;
    if (matchId === null || matchId === undefined || matchId === "") {
      return;
    }

    setDeletingMatchId(matchId);
    setLedgerError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/matches/${matchId}`, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 204) {
        let detailMessage = "Failed to delete the saved match.";
        try {
          const errorData = await response.json();
          if (errorData?.detail) {
            detailMessage = errorData.detail;
          }
        } catch (parseError) {
          // Response had no JSON body; keep default detailMessage.
        }
        throw new Error(detailMessage);
      }

      setSessionMatches((current) =>
        current.filter((match) => match.id !== matchId)
      );
      setPendingDeleteId(null);
    } catch (deleteError) {
      setLedgerError(
        deleteError.message || "Failed to delete the saved match."
      );
    } finally {
      setDeletingMatchId(null);
    }
  }

  useEffect(() => {
    if (pendingDeleteId === null) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && deletingMatchId === null) {
        setPendingDeleteId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingDeleteId, deletingMatchId]);

  function handleCvTextChange(event) {
    setCvText(event.target.value);
  }

  function handleJobDescriptionChange(event) {
    setJobDescription(event.target.value);
  }

  // Collapse a field into its compact "on file" card only when a full
  // document is pasted in — never while the user is typing, which would
  // yank the textarea away mid-sentence.
  function handleCvPaste(event) {
    const pastedText = event.clipboardData?.getData("text") || "";
    if (!cvPreviewMode && hasMeaningfulContent(pastedText)) {
      setCvPreviewMode(true);
    }
  }

  function handleJobPaste(event) {
    const pastedText = event.clipboardData?.getData("text") || "";
    if (!jobPreviewMode && hasMeaningfulContent(pastedText)) {
      setJobPreviewMode(true);
    }
  }

  async function handlePdfUpload(event) {
    const selectedFile = event.target.files?.[0];

    setUploadMessage("");
    setError("");

    if (!selectedFile) {
      return;
    }

    const hasPdfMimeType = selectedFile.type === "application/pdf";
    const hasPdfExtension = selectedFile.name.toLowerCase().endsWith(".pdf");

    if (!hasPdfMimeType && !hasPdfExtension) {
      setError("Please upload a PDF file.");
      event.target.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setUploadingPdf(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/extract-cv-pdf`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "PDF extraction failed.");
      }

      setCvText(data.extracted_text);
      setCvPreviewMode(true);
      setUploadMessage(`PDF uploaded successfully: ${data.filename}`);
    } catch (uploadError) {
      setError(uploadError.message || "Failed to extract text from the PDF.");
    } finally {
      setUploadingPdf(false);
      event.target.value = "";
    }
  }

  // Bring the freshly generated report into view — otherwise the result
  // renders below the fold and the page looks like nothing happened.
  useEffect(() => {
    if (result) {
      reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  function startNewMatch() {
    setCvText("");
    setJobDescription("");
    setCvPreviewMode(false);
    setJobPreviewMode(false);
    setResult(initialResult);
    setError("");
    setUploadMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadSamplePair() {
    setCvText(SAMPLE_CV);
    setJobDescription(SAMPLE_JOB);
    setCvPreviewMode(true);
    setJobPreviewMode(true);
    setError("");
    setUploadMessage("");
  }

  async function handleMatch() {
    if (!cvText.trim() || !jobDescription.trim()) {
      setError("Please enter both the CV text and the job description.");
      setResult(initialResult);
      return;
    }

    setLoading(true);
    setError("");
    setResult(initialResult);

    try {
      const response = await fetch(`${API_BASE_URL}/api/match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cv_text: cvText,
          job_description: jobDescription,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Request failed.");
      }

      setResult(data);
      setSessionMatches((current) => [
        {
          id: data.record_id,
          created_at: data.created_at || new Date().toISOString(),
          semantic_score: data.semantic_score,
          keyword_score: data.keyword_score,
          final_score: data.final_score,
          match_level: data.match_level,
          matching_skills: data.explanation?.matching_skills || [],
          missing_skills: data.explanation?.missing_skills || [],
          short_explanation: data.explanation?.short_explanation || "",
        },
        ...current,
      ]);
    } catch (requestError) {
      setError(
        requestError.message ||
          "Something went wrong while matching the CV to the job description."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <div className="container">
        <header className="masthead">
          <div className="masthead-top">
            <div>
              <p className="masthead-eyebrow">
                Dissertation Project · Semantic Matching Engine
              </p>
              <h1 className="masthead-title">
                AI CV Matcher<span className="title-period">.</span>
              </h1>
            </div>
            <aside className="masthead-meta">
              <span>Vol. 01 — MMXXVI</span>
              <span>Embeddings + Keyword Analysis</span>
              <span>Explainable by Design</span>
            </aside>
          </div>
          <div className="rule-double" role="presentation" />
          <p className="masthead-intro">
            Submit a curriculum vitae and a job description. The engine measures
            semantic similarity and keyword coverage, then issues a typeset
            match report with an explainable verdict.
          </p>
        </header>

        <section>
          <FolioHead
            no="01"
            title="Exhibits"
            aside={
              <button
                className="btn-ghost"
                type="button"
                onClick={loadSamplePair}
                disabled={loading || uploadingPdf}
              >
                Load sample pair
              </button>
            }
          />

          <div className="exhibit-grid">
            <div className="exhibit">
              <span className="exhibit-label">
                Exhibit <b>A</b> — Curriculum Vitae
              </span>
              <div className="exhibit-body">
                <p className="exhibit-hint">
                  Paste the CV text, or upload a text-based PDF to extract it
                  automatically.
                </p>

                {cvPreviewMode ? (
                  <InputPreviewCard
                    title="CV"
                    text={cvText}
                    type="cv"
                    onEdit={() => !loading && setCvPreviewMode(false)}
                  />
                ) : (
                  <>
                    <label className="upload-panel" htmlFor="cvPdf">
                      <span className="upload-copy">
                        <span className="upload-title">Upload PDF CV</span>
                        <span className="upload-status">
                          {uploadingPdf
                            ? "Extracting PDF text..."
                            : "Select a text-based PDF, or click to browse"}
                        </span>
                      </span>
                      <span className="upload-action">
                        {uploadingPdf ? "Processing" : "Choose file"}
                      </span>
                      <input
                        id="cvPdf"
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={handlePdfUpload}
                        disabled={uploadingPdf || loading}
                      />
                    </label>

                    {uploadMessage ? (
                      <p className="msg msg-success">{uploadMessage}</p>
                    ) : null}

                    <div className="field-group">
                      <label htmlFor="cvText">CV Text</label>
                      <textarea
                        id="cvText"
                        value={cvText}
                        onChange={handleCvTextChange}
                        onPaste={handleCvPaste}
                        placeholder="Paste the CV text here..."
                        rows={14}
                      />
                      <div className="field-foot">
                        <WordCount text={cvText} />
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => setCvPreviewMode(true)}
                          disabled={!hasMeaningfulContent(cvText) || loading}
                        >
                          File document
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="exhibit">
              <span className="exhibit-label">
                Exhibit <b>B</b> — Job Description
              </span>
              <div className="exhibit-body">
                <p className="exhibit-hint">
                  Paste the job description, including the main responsibilities
                  and technical requirements.
                </p>

                {jobPreviewMode ? (
                  <InputPreviewCard
                    title="Job Description"
                    text={jobDescription}
                    type="job"
                    onEdit={() => !loading && setJobPreviewMode(false)}
                  />
                ) : (
                  <div className="field-group">
                    <label htmlFor="jobDescription">Role Brief</label>
                    <textarea
                      id="jobDescription"
                      value={jobDescription}
                      onChange={handleJobDescriptionChange}
                      onPaste={handleJobPaste}
                      placeholder="Paste the job description here..."
                      rows={14}
                    />
                    <div className="field-foot">
                      <WordCount text={jobDescription} />
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={() => setJobPreviewMode(true)}
                        disabled={!hasMeaningfulContent(jobDescription) || loading}
                      >
                        File document
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="action-strip">
            <button
              className="btn-run"
              onClick={handleMatch}
              disabled={!canRunMatch}
            >
              {loading ? (
                <>
                  <LoadingSpinner />
                  Running analysis...
                </>
              ) : (
                "Run the Match"
              )}
            </button>
            <button
              className="btn-ghost"
              type="button"
              onClick={startNewMatch}
              disabled={
                loading ||
                uploadingPdf ||
                (!cvText.trim() && !jobDescription.trim() && !result)
              }
            >
              Start over
            </button>
          </div>

          {error ? <p className="msg msg-error">{error}</p> : null}
        </section>

        <section ref={reportRef}>
          <FolioHead
            no="02"
            title="The Report"
            aside={result ? "Generated just now" : "Pending"}
          />

          {result ? (
            <div className="report" key={result.final_score}>
              <div className="report-verdict rise">
                <div>
                  <p className="report-score-label">Final Match Score</p>
                  <p className="report-score">
                    {formatScore(result.final_score)}
                  </p>
                  <p className="report-deck">
                    {result.score_interpretation ||
                      "The final score combines semantic similarity and keyword overlap."}
                  </p>
                </div>
                <span className={`stamp ${levelTone(result.match_level)}`}>
                  {result.match_level}
                </span>
              </div>

              <div className="report-columns rise">
                <div className="score-ledger">
                  <LedgerScore
                    label="Semantic Similarity"
                    score={result.semantic_score}
                    tone="ink"
                  />
                  <LedgerScore
                    label="Keyword Coverage"
                    score={result.keyword_score}
                    tone="accent"
                  />
                </div>

                <div className="score-ledger">
                  <div className="skill-block">
                    <h3>
                      Matched Skills
                      <span className="skill-count">
                        {result.explanation?.matching_skills?.length || 0}
                      </span>
                    </h3>
                    <div className="chip-group">
                      {result.explanation?.matching_skills?.length ? (
                        result.explanation.matching_skills.map(
                          (skill, index) => (
                            <span
                              className="chip chip-matched"
                              key={`${skill}-${index}`}
                            >
                              {skill}
                            </span>
                          )
                        )
                      ) : (
                        <span className="empty-note">
                          No matching skills detected.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="skill-block">
                    <h3>
                      Missing Skills
                      <span className="skill-count">
                        {result.explanation?.missing_skills?.length || 0}
                      </span>
                    </h3>
                    <div className="chip-group">
                      {result.explanation?.missing_skills?.length ? (
                        result.explanation.missing_skills.map(
                          (skill, index) => (
                            <span
                              className="chip chip-missing"
                              key={`${skill}-${index}`}
                            >
                              {skill}
                            </span>
                          )
                        )
                      ) : (
                        <span className="empty-note">
                          No missing skills detected.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="report-columns rise">
                <div className="note note-accent">
                  <h3>Recommendation</h3>
                  <p>{buildRecommendation(result)}</p>
                </div>

                <div className="note">
                  <h3>Analyst's Note</h3>
                  <p>
                    {result.explanation?.short_explanation ||
                      "No explanation returned."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="report-empty">
              <p className="report-empty-title">Awaiting analysis.</p>
              <p className="report-empty-sub">
                File Exhibits A &amp; B — or load the sample pair — then run
                the match
              </p>
            </div>
          )}
        </section>

        <section>
          <FolioHead no="03" title="Match Ledger" aside="This visit" />

          <div className="ledger-card">
            <div className="ledger-head">
              <div>
                <h2 className="ledger-title">Your matches this visit</h2>
                <p>
                  Every match you run here is listed below, so you can compare
                  runs side by side. Only your own session appears — never
                  anyone else's.
                </p>
              </div>
            </div>

            {ledgerError ? <p className="msg msg-error">{ledgerError}</p> : null}

            {sessionMatches.length === 0 ? (
              <p className="empty-note">
                Nothing on file yet — run a match above and it will appear
                here.
              </p>
            ) : (
              <ul className="saved-list">
                {sessionMatches.map((match, index) => (
                  <li className="saved-row" key={match.id || `local-${index}`}>
                    <div className="saved-score">
                      <strong>{formatScore(match.final_score)}</strong>
                      <span
                        className={`saved-level ${levelTone(
                          match.match_level
                        )}`}
                      >
                        {match.match_level || "Unknown"}
                      </span>
                    </div>
                    <div className="saved-meta">
                      <span className="saved-date">
                        {formatSavedDate(match.created_at)}
                      </span>
                      <span className="saved-sub">
                        Semantic {formatScore(match.semantic_score)} · Keyword{" "}
                        {formatScore(match.keyword_score)}
                      </span>
                      <span className="saved-sub">
                        Matched {match.matching_skills?.length || 0} · Missing{" "}
                        {match.missing_skills?.length || 0}
                      </span>
                      {match.short_explanation ? (
                        <p className="saved-explanation">
                          {match.short_explanation}
                        </p>
                      ) : null}
                    </div>
                    {match.id ? (
                      <button
                        className="saved-delete"
                        type="button"
                        onClick={() => requestDeleteMatch(match.id)}
                        disabled={deletingMatchId === match.id}
                      >
                        {deletingMatchId === match.id
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <footer className="colophon">
          Research prototype — not intended for real recruitment decisions
        </footer>
      </div>

      {pendingDeleteId !== null ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={cancelDeleteMatch}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-match-title"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="modal-kicker">Confirmation</p>
            <h3 id="delete-match-title" className="modal-title">
              Strike this record?
            </h3>
            <p className="modal-body">
              This will permanently remove the saved match record from the
              ledger.
            </p>
            <div className="modal-actions">
              <button
                className="btn-ghost"
                type="button"
                onClick={cancelDeleteMatch}
                disabled={deletingMatchId !== null}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                type="button"
                onClick={confirmDeleteMatch}
                disabled={deletingMatchId !== null}
              >
                {deletingMatchId !== null ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
