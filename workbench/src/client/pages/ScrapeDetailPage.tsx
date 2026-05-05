import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useScrape, useDeleteScrape, useAiParse, useSettings } from "../lib/hooks";
import { useToast } from "../components/Toast";
import ExtractionPanel from "../components/ExtractionPanel";
import StructuredResultViewer from "../components/StructuredResultViewer";
import ConfirmModal from "../components/ConfirmModal";
import * as api from "../lib/api";


export default function ScrapeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: job, isLoading, refetch } = useScrape(Number(id));
  const { toast } = useToast();
  const deleteMutation = useDeleteScrape();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState(false);
  const [showExtraction, setShowExtraction] = useState(false);

  const [caching, setCaching] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(true);
  const aiParseMutation = useAiParse();
  const { data: settingsData } = useSettings();
  const [aiParseMode, setAiParseMode] = useState("general");

  if (isLoading) return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div className="skeleton" style={{ width: "60%", height: "1.5rem" }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem" }}>
        {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: "4rem" }} />)}
      </div>
    </div>
  );
  if (!job) return <p style={{ color: "var(--color-error)" }}>Job not found</p>;

  const isActive = job.status === "running" || job.status === "pending";
  const isApiJob = job.config?.type === "api";
  const jobId = Number(id);
  const progress = job.progress as { completed: number; total: number; currentUrl?: string } | null;
  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const resultSummary = job.resultSummary as { type?: string; resultsCount?: number; errorsCount?: number } | null;

  const handleDeleteJob = async () => {
    try {
      await deleteMutation.mutateAsync(jobId);
      toast("Scrape job deleted", "success");
      navigate("/scrapes");
    } catch (err: any) {
      toast(err.message, "error");
    }
    setConfirmDeleteJob(false);
  };

  const handlePrecacheImages = async () => {
    setCaching(true);
    try {
      const result = await api.images.precache(jobId);
      toast(`Cached ${result.cached} of ${result.total} images${result.failed > 0 ? ` (${result.failed} failed)` : ""}`, result.failed > 0 ? "warning" : "success");
    } catch (err: any) {
      toast(`Image caching failed: ${err.message}`, "error");
    }
    setCaching(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <Link to="/scrapes" className="text-sm no-underline flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </Link>
        <span className="text-base font-semibold" style={{ letterSpacing: "-0.01em" }}>{job.name}</span>
        <span className={`badge badge-${job.status}`}>
          <span className={`status-dot status-dot-${job.status}`} />
          {job.status}
        </span>
        {isApiJob && (
          <span className="badge badge-running" style={{ fontSize: "0.65rem" }}>API</span>
        )}
        {job.status === "completed" && (
          <div className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
            <Link
              to={`/scrapes/${jobId}/api`}
              style={{ padding: "0.4rem 0.75rem", border: "1px solid #ddd", borderRadius: "0.25rem", textDecoration: "none" }}
            >
              AI Pipeline
            </Link>
            <Link
              to={`/scrapes/${id}/build`}
              className="btn-ghost no-underline flex items-center gap-1.5"
              style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              Build Dataset
            </Link>
            <button
              onClick={() => setShowExtraction(!showExtraction)}
              className={showExtraction ? "btn-primary" : "btn-ghost"}
              style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
              Extract Data
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              <select
                value={aiParseMode}
                onChange={e => setAiParseMode(e.target.value)}
                disabled={aiParseMutation.isPending}
                style={{
                  padding: "0.25rem 0.4rem",
                  fontSize: "0.7rem",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRight: "none",
                  borderRadius: "var(--radius) 0 0 var(--radius)",
                  color: "var(--color-text)",
                  outline: "none",
                  height: "100%",
                  maxWidth: 120
                }}
              >
                {(settingsData?.parseModes || [
                  { value: "general", label: "General" },
                  { value: "ecommerce", label: "Ecommerce" },
                  { value: "articles", label: "Articles" },
                  { value: "contacts", label: "Contacts" },
                  { value: "real_estate", label: "Real Estate" },
                  { value: "jobs", label: "Jobs" }
                ]).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <button
                onClick={async () => {
                  try {
                    const result = await aiParseMutation.mutateAsync({ jobId: Number(id), mode: aiParseMode });
                    toast(`AI parsed ${result.rowCount} rows into dataset #${result.datasetId}`, "success");
                  } catch (err: any) {
                    toast(err.message, "error");
                  }
                }}
                disabled={aiParseMutation.isPending}
                className="btn-ghost"
                style={{
                  padding: "0.25rem 0.6rem",
                  fontSize: "0.75rem",
                  borderRadius: "0 var(--radius) var(--radius) 0",
                  borderLeft: "none"
                }}
              >
                {aiParseMutation.isPending ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                      style={{ animation: "spin 1s linear infinite" }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Parsing...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93" />
                      <path d="M8.24 4.85A4 4 0 0 1 12 2" />
                      <path d="M5 10c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2z" />
                      <path d="M12 14v8" /><path d="M8 22h8" />
                    </svg>
                    AI Parse
                  </>
                )}
              </button>
            </div>
            <button
              onClick={handlePrecacheImages}
              disabled={caching}
              className="btn-ghost"
              style={{ padding: "0.25rem 0.6rem", fontSize: "0.75rem" }}
            >
              {caching ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Caching...
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  Download Images
                </>
              )}
            </button>
          </div>
        )}
        <button
          onClick={() => setConfirmDeleteJob(true)}
          style={{
            marginLeft: job.status !== "completed" ? "auto" : undefined,
            padding: "0.35rem",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--color-error)",
            display: "inline-flex"
          }}
          title="Delete this scrape job"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-error)" stroke="none">
            <path d="M3 6h18v2H3V6zm2 2h14l-1.5 14a1 1 0 0 1-1 .9H8.5a1 1 0 0 1-1-.9L5 8zm4-4v2h6V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1z" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      {isActive && progress && progress.total > 0 && (
        <div className="mb-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {progress.completed}/{progress.total} {isApiJob ? "requests" : "URLs"}
            </span>
            <span className="text-xs font-mono" style={{ color: "var(--color-primary)" }}>{pct}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          {progress.currentUrl && (
            <div className="text-xs mt-1 truncate" style={{ color: "var(--color-text-muted)", maxWidth: "100%" }}>
              {progress.currentUrl}
            </div>
          )}
        </div>
      )}

      {/* Pending state message */}
      {job.status === "pending" && !progress && (
        <div className="text-xs mb-1" style={{ color: "var(--color-warning)" }}>
          Starting up... spawning database container
        </div>
      )}

      {/* Stats bar */}
      <div className="mb-2">
        <button
          type="button"
          onClick={() => setShowStats(!showStats)}
          className="text-xs flex items-center gap-1 mb-1 border-none bg-transparent cursor-pointer"
          style={{ color: "var(--color-text-muted)", padding: 0 }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: showStats ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }}>
            <path d="m9 18 6-6-6-6" />
          </svg>
          Details
        </button>
        {showStats && (
          <div className="stat-card flex items-center gap-6 flex-wrap">
            <div>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>URLs </span>
              <span className="text-sm font-bold">{job.urls?.length || 0}</span>
            </div>
            <div>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Results </span>
              <span className="text-sm font-bold">{job.results?.length || 0}</span>
            </div>
            <div>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Created </span>
              <span className="text-sm">{new Date(job.createdAt).toLocaleString()}</span>
            </div>
            {job.completedAt && (
              <div>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Duration </span>
                <span className="text-sm">{((new Date(job.completedAt).getTime() - new Date(job.startedAt || job.createdAt).getTime()) / 1000).toFixed(1)}s</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* API result summary */}
      {isApiJob && resultSummary && job.status === "completed" && (
        <div className="glass-card p-3 mb-2 flex items-center gap-4 flex-wrap">
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span style={{ color: "var(--color-success)", fontWeight: 600 }}>{resultSummary.resultsCount || 0} successful</span>
            {(resultSummary.errorsCount || 0) > 0 && (
              <span style={{ color: "var(--color-error)", marginLeft: "0.75rem", fontWeight: 600 }}>{resultSummary.errorsCount} errors</span>
            )}
          </div>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Use <strong>Build Dataset</strong> to extract items from the JSON responses into a table.
          </span>
        </div>
      )}

      {/* Extraction panel */}
      {showExtraction && (
        <ExtractionPanel
          jobId={jobId}
          hasRawHtml={job.results?.some((r: any) => r.rawHtml) || false}
        />
      )}

      {/* Warnings */}
      {job.errorMessage && (
        <div className="glass-card p-3 mb-2" style={{ borderLeft: "3px solid var(--color-error)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--color-error)" }}>Error</div>
          <div className="text-sm mt-1">{job.errorMessage}</div>
        </div>
      )}

      {/* Config tags */}
      {isApiJob && (
        <div className="mb-2">
          <h2 className="text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Configuration</h2>
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-xs px-2 py-0.5" style={{ background: "var(--color-surface-glass)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
              type: api
            </span>
            {job.config.delay != null && (
              <span className="text-xs px-2 py-0.5" style={{ background: "var(--color-surface-glass)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                delay: {job.config.delay}ms
              </span>
            )}
            {job.config.timeout != null && (
              <span className="text-xs px-2 py-0.5" style={{ background: "var(--color-surface-glass)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                timeout: {job.config.timeout}ms
              </span>
            )}
            {job.config.headers && Object.keys(job.config.headers).length > 0 && (
              <span className="text-xs px-2 py-0.5" style={{ background: "var(--color-surface-glass)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                {Object.keys(job.config.headers).length} custom headers
              </span>
            )}
          </div>
        </div>
      )}
      {!isApiJob && job.config?.options && Object.keys(job.config.options).length > 0 && (
        <div className="mb-2">
          <h2 className="text-xs font-semibold mb-1 uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Configuration</h2>
          <div className="flex gap-1.5 flex-wrap">
            {Object.entries(job.config.options).map(([k, v]: [string, any]) => {
              if (v === false || v === null || v === undefined || v === "" || v === "GET") return null;
              const display = typeof v === "boolean" ? k : `${k}: ${typeof v === "object" ? JSON.stringify(v).substring(0, 40) : v}`;
              return (
                <span key={k} className="text-xs px-2 py-0.5" style={{
                  background: "var(--color-surface-glass)",
                  color: "var(--color-text-muted)",
                  border: "1px solid var(--color-border)"
                }}>
                  {display}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Results table */}
      {job.results?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-1 uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Results</h2>
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Timing</th>
                    <th>Type</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {job.results.map((r: any, i: number) => (
                    <React.Fragment key={i}>
                      <tr style={{ cursor: "pointer" }} onClick={() => setExpandedRow(expandedRow === i ? null : i)}>
                        <td className="max-w-xs truncate">{r.url}</td>
                        <td>
                          <span style={{ color: r.error ? "var(--color-error)" : "var(--color-success)" }}>
                            {r.error ? "error" : r.status}
                          </span>
                          {r.originalStatus && r.originalStatus !== r.status && (
                            <span className="ml-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                              (orig: {r.originalStatus})
                            </span>
                          )}
                        </td>
                        <td>{r.timing ? `${r.timing}ms` : "-"}</td>
                        <td>
                          {r.responseType && r.responseType !== "html" && (
                            <span className="badge badge-running">{r.responseType}</span>
                          )}
                        </td>
                        <td className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                          {r.extractedData ? "extracted " : ""}
                          {r.autoparseData ? "autoparsed " : ""}
                          {r.networkRequests?.length ? `${r.networkRequests.length} xhr ` : ""}
                          {r.screenshotBase64 ? "screenshot " : ""}
                          {r.convertedContent ? "converted " : ""}
                          {r.error || ""}
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                            style={{ marginLeft: "0.5rem", verticalAlign: "middle", transform: expandedRow === i ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", opacity: 0.4 }}>
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </td>
                      </tr>
                      {expandedRow === i && (
                        <tr>
                          <td colSpan={5} style={{ padding: "1rem", background: "var(--color-surface-glass)" }}>
                            <StructuredResultViewer
                              result={r}
                              jobId={jobId}
                              onLightbox={setLightboxSrc}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete job modal */}
      <ConfirmModal
        open={confirmDeleteJob}
        title="Delete Scrape Job"
        confirmLabel="Delete"
        confirmColor="var(--color-error)"
        onConfirm={handleDeleteJob}
        onCancel={() => setConfirmDeleteJob(false)}
        loading={deleteMutation.isPending}
      >
        <p className="m-0">
          This will permanently delete this scrape job and all its results.
        </p>
      </ConfirmModal>



      {/* Image Lightbox */}
      {lightboxSrc && (
        <div className="modal-backdrop" onClick={() => setLightboxSrc(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
            <img
              src={lightboxSrc}
              alt=""
              style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "var(--radius-lg)", objectFit: "contain" }}
            />
            <button
              onClick={() => setLightboxSrc(null)}
              style={{
                position: "absolute", top: "-12px", right: "-12px", width: "28px", height: "28px",
                borderRadius: "50%", border: "1px solid var(--color-border)", background: "var(--color-surface-raised)",
                color: "var(--color-text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "14px", fontWeight: "bold"
              }}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
