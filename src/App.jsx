import { useEffect, useState } from "react";

const API_BASE_URL = "http://127.0.0.1:8000";

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

function countWords(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function hasMeaningfulContent(text) {
  return countWords(text) >= 8;
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

function ScoreBar({ label, score, tone }) {
  return (
    <div className="metric-card">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <strong>{formatScore(score)}</strong>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill ${tone}`}
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
    <div className="input-preview-card">
      <div className="input-preview-header">
        <div>
          <p className="input-preview-status">{title} Loaded ✔</p>
          <strong>{countWords(text)} words</strong>
        </div>
        <button className="preview-edit-button" type="button" onClick={onEdit}>
          Edit
        </button>
      </div>
      {summaryTags.length ? (
        <div className="preview-tag-group">
          {summaryTags.map((tag) => (
            <span className="preview-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <p className="input-preview-text">{buildPreviewText(text)}</p>
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
  const [savedMatches, setSavedMatches] = useState([]);
  const [savedMatchesLoading, setSavedMatchesLoading] = useState(false);
  const [savedMatchesError, setSavedMatchesError] = useState("");
  const [deletingMatchId, setDeletingMatchId] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const canRunMatch =
    Boolean(cvText.trim()) &&
    Boolean(jobDescription.trim()) &&
    !loading &&
    !uploadingPdf;

  async function loadSavedMatches() {
    setSavedMatchesLoading(true);
    setSavedMatchesError("");

    try {
      const response = await fetch(`${API_BASE_URL}/matches?limit=5`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to load saved matches.");
      }

      setSavedMatches(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setSavedMatchesError(
        loadError.message || "Failed to load saved matches."
      );
      setSavedMatches([]);
    } finally {
      setSavedMatchesLoading(false);
    }
  }

  useEffect(() => {
    loadSavedMatches();
  }, []);

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
    setSavedMatchesError("");

    try {
      const response = await fetch(`${API_BASE_URL}/matches/${matchId}`, {
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

      await loadSavedMatches();
      setPendingDeleteId(null);
    } catch (deleteError) {
      setSavedMatchesError(
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
    const nextText = event.target.value;
    setCvText(nextText);

    if (!cvPreviewMode && hasMeaningfulContent(nextText)) {
      setCvPreviewMode(true);
    }
  }

  function handleJobDescriptionChange(event) {
    const nextText = event.target.value;
    setJobDescription(nextText);

    if (!jobPreviewMode && hasMeaningfulContent(nextText)) {
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

    console.log("[PDF DEBUG] File selected:", {
      name: selectedFile.name,
      type: selectedFile.type,
      size: selectedFile.size,
    });

    if (!hasPdfMimeType && !hasPdfExtension) {
      setError("Please upload a PDF file.");
      event.target.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    console.log("[PDF DEBUG] Sending file to backend using multipart/form-data.");

    setUploadingPdf(true);

    try {
      const response = await fetch(`${API_BASE_URL}/extract-cv-pdf`, {
        method: "POST",
        body: formData,
      });

      console.log("[PDF DEBUG] Upload response status:", response.status);

      const data = await response.json();
      console.log("[PDF DEBUG] Upload response body:", data);

      if (!response.ok) {
        throw new Error(data.detail || "PDF extraction failed.");
      }

      setCvText(data.extracted_text);
      setCvPreviewMode(true);
      setUploadMessage(`PDF uploaded successfully: ${data.filename}`);
      console.log("[PDF DEBUG] Extracted text length:", data.extracted_text?.length || 0);
    } catch (uploadError) {
      console.error("[PDF DEBUG] PDF upload failed:", uploadError);
      setError(uploadError.message || "Failed to extract text from the PDF.");
    } finally {
      setUploadingPdf(false);
      event.target.value = "";
    }
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
      const response = await fetch(`${API_BASE_URL}/match`, {
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
      loadSavedMatches();
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
        <header className="hero">
          <p className="eyebrow">Dissertation Project</p>
          <h1>AI CV Matcher</h1>
          <p className="intro">
            Upload a CV, compare it with a job description, and review an
            AI-generated matching score and explanation.
          </p>
        </header>

        <section className="workspace">
          <div className="workspace-header">
            <div>
              <p className="section-label">Input Section</p>
              <h2>Provide the CV and job description</h2>
              <p className="workspace-copy">
                You can paste CV text manually or upload a PDF CV for text
                extraction before running the match.
              </p>
            </div>
          </div>

          <div className="input-grid">
            <section className="card input-card input-card-primary">
              <div className="card-head">
                <div>
                  <p className="card-kicker">CV</p>
                  <h3>CV Input</h3>
                </div>
                <span className="card-tag">Manual or PDF</span>
              </div>

              <p className="field-hint">
                Paste CV text manually, or upload a PDF to extract the text
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
                    <div className="upload-copy">
                      <span className="upload-title">Upload PDF CV</span>
                      <span className="upload-status">
                        {uploadingPdf
                          ? "Extracting PDF text..."
                          : "Select a text-based PDF or click to browse"}
                      </span>
                    </div>
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

                  {uploadMessage ? <p className="message success">{uploadMessage}</p> : null}

                  <div className="field-group">
                    <label htmlFor="cvText">CV Text</label>
                    <textarea
                      id="cvText"
                      value={cvText}
                      onChange={handleCvTextChange}
                      placeholder="Paste the CV text here..."
                      rows={14}
                    />
                  </div>
                </>
              )}
            </section>

            <section className="card input-card">
              <div className="card-head">
                <div>
                  <p className="card-kicker">Job Description</p>
                  <h3>Job Description</h3>
                </div>
                <span className="card-tag">Required</span>
              </div>

              <p className="field-hint">
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
                    placeholder="Paste the job description here..."
                    rows={14}
                  />
                </div>
              )}
            </section>
          </div>

          <div className="action-area">
            <button
              className="match-button"
              onClick={handleMatch}
              disabled={!canRunMatch}
            >
              {loading ? (
                <>
                  <LoadingSpinner />
                  Running analysis...
                </>
              ) : (
                "Match Candidate"
              )}
            </button>
          </div>

          {error ? <p className="message error">{error}</p> : null}
        </section>

        {result ? (
          <section className="card results-card">
            <div className="results-header">
              <div>
                <p className="section-label">Results</p>
                <h2>Match Results</h2>
                <p className="results-intro">
                  The final score combines semantic similarity and keyword
                  overlap.
                </p>
              </div>

              <div className="hero-score-card">
                <span className="score-label">Final Match Score</span>
                <strong>{formatScore(result.final_score)}</strong>
                <span className="match-badge">{result.match_level}</span>
              </div>
            </div>

            <div className="dashboard-main dashboard-section">
              <div className="dashboard-column">
                <ScoreBar
                  label="Semantic Score"
                  score={result.semantic_score}
                  tone="semantic"
                />
                <ScoreBar
                  label="Keyword Score"
                  score={result.keyword_score}
                  tone="keyword"
                />
              </div>

              <div className="dashboard-column">
                <div className="result-panel">
                  <h3>Matching Skills</h3>
                  <div className="chip-group">
                    {result.explanation?.matching_skills?.length ? (
                      result.explanation.matching_skills.map((skill, index) => (
                        <span className="chip chip-positive" key={`${skill}-${index}`}>
                          {skill}
                        </span>
                      ))
                    ) : (
                      <span className="empty-state">No matching skills returned.</span>
                    )}
                  </div>
                </div>

                <div className="result-panel">
                  <h3>Missing Skills</h3>
                  <div className="chip-group">
                    {result.explanation?.missing_skills?.length ? (
                      result.explanation.missing_skills.map((skill, index) => (
                        <span className="chip chip-warning" key={`${skill}-${index}`}>
                          {skill}
                        </span>
                      ))
                    ) : (
                      <span className="empty-state">No missing skills returned.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="dashboard-grid dashboard-section">
              <div className="result-panel recommendation-panel">
                <h3>Recommendation</h3>
                <p>{buildRecommendation(result)}</p>
              </div>

              <div className="result-panel insight-panel">
                <h3>Short Explanation</h3>
                <p>{result.explanation?.short_explanation || "No explanation returned."}</p>
              </div>
            </div>
          </section>
        ) : (
          <section className="card empty-dashboard">
            <div className="empty-dashboard-copy">
              <p className="section-label">No Results Yet</p>
              <h2>Your results will appear here.</h2>
              <p>
                Add a CV and job description, then run a match to view the
                score, identified skills, explanation, and recommendation.
              </p>
            </div>

            <div className="empty-preview-grid">
              <div className="preview-card preview-card-primary">
                <span>Final Match Score</span>
                <strong>--</strong>
                <div className="preview-pill">Waiting for input</div>
              </div>
              <div className="preview-card">
                <span>Semantic Score</span>
                <div className="preview-bar" />
              </div>
              <div className="preview-card">
                <span>Keyword Score</span>
                <div className="preview-bar preview-bar-secondary" />
              </div>
            </div>
          </section>
        )}

        <section className="card saved-matches-card">
          <div className="saved-matches-header">
            <div>
              <p className="section-label">Saved Matches</p>
              <h2>Match History</h2>
              <p className="results-intro">
                Showing the 5 most recent saved matches. The full CV and job
                description are never returned to the browser.
              </p>
            </div>
            <button
              className="preview-edit-button"
              type="button"
              onClick={loadSavedMatches}
              disabled={savedMatchesLoading}
            >
              {savedMatchesLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {savedMatchesError ? (
            <p className="message error">{savedMatchesError}</p>
          ) : null}

          {savedMatchesLoading && savedMatches.length === 0 ? (
            <p className="empty-state">Loading saved matches...</p>
          ) : savedMatches.length === 0 ? (
            <p className="empty-state">
              No saved matches yet. Run a match above to see it appear here.
            </p>
          ) : (
            <ul className="saved-matches-list">
              {savedMatches.map((match) => (
                <li className="saved-match-row" key={match.id}>
                  <div className="saved-match-summary">
                    <div className="saved-match-score">
                      <span className="score-label">Final</span>
                      <strong>{formatScore(match.final_score)}</strong>
                      <span className="match-badge">
                        {match.match_level || "Unknown"}
                      </span>
                    </div>
                    <div className="saved-match-meta">
                      <span className="saved-match-date">
                        {formatSavedDate(match.created_at)}
                      </span>
                      <span className="saved-match-sub">
                        Semantic {formatScore(match.semantic_score)} ·
                        Keyword {formatScore(match.keyword_score)}
                      </span>
                      <span className="saved-match-sub">
                        Matched {match.matching_skills?.length || 0} ·
                        Missing {match.missing_skills?.length || 0}
                      </span>
                      {match.short_explanation ? (
                        <p className="saved-match-explanation">
                          {match.short_explanation}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    className="saved-match-delete"
                    type="button"
                    onClick={() => requestDeleteMatch(match.id)}
                    disabled={deletingMatchId === match.id}
                  >
                    {deletingMatchId === match.id ? "Deleting..." : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
            <p className="section-label">Confirmation</p>
            <h3 id="delete-match-title" className="modal-title">
              Delete saved match?
            </h3>
            <p className="modal-body">
              This will permanently remove this saved match record from the
              database.
            </p>
            <div className="modal-actions">
              <button
                className="modal-button modal-button-cancel"
                type="button"
                onClick={cancelDeleteMatch}
                disabled={deletingMatchId !== null}
              >
                Cancel
              </button>
              <button
                className="modal-button modal-button-danger"
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
