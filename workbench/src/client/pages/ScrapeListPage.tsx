import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useScrapes, useDeleteScrape } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "../lib/api";

export default function ScrapeListPage() {
  const { data, isLoading } = useScrapes();
  const deleteMutation = useDeleteScrape();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast("Scrape job deleted", "success");
    } catch (err: any) {
      toast(err.message, "error");
    }
    setDeleteId(null);
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const result = await api.scrapes.reset();
      queryClient.invalidateQueries();
      toast(`Reset complete — ${result.containersRemoved} container(s) removed`, "success");
      if (result.errors?.length) {
        toast(`${result.errors.length} warning(s) during reset`, "warning");
      }
    } catch (err: any) {
      toast(err.message, "error");
    }
    setResetting(false);
    setShowReset(false);
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReset(true)}
            className="btn-ghost"
            style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
            title="Reset all data"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Reset
          </button>
          <Link to="/scrapes/new" className="btn-primary no-underline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Scrape
          </Link>
        </div>
      </div>

      {isLoading && (
        <div className="glass-card overflow-hidden">
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: "2.25rem", borderRadius: 0 }} />)}
        </div>
      )}

      {!isLoading && data?.jobs?.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <p className="text-sm m-0 mb-2" style={{ fontWeight: 500 }}>No scrape jobs yet</p>
          <p className="text-xs m-0">Create one to start scraping web pages.</p>
        </div>
      )}

      {!isLoading && data?.jobs && data.jobs.length > 0 && (
        <div className="glass-card overflow-hidden">
          {data.jobs.map((job: any, i: number) => {
            const progress = job.progress as { completed: number; total: number } | null;
            const isActive = job.status === "running" || job.status === "pending";
            const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

            return (
              <div
                key={job.id}
                className="list-row"
                style={{ borderTop: i > 0 ? "1px solid var(--color-border)" : "none" }}
              >
                <Link
                  to={`/scrapes/${job.id}`}
                  className="list-row-link"
                >
                  <span className="font-semibold text-sm" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.name}</span>
                  <span className={`badge badge-${job.status}`} style={{ flexShrink: 0 }}>
                    <span className={`status-dot status-dot-${job.status}`} />
                    {job.status}
                  </span>
                  {isActive && progress && progress.total > 0 && (
                    <span className="text-xs font-mono" style={{ color: "var(--color-primary)", flexShrink: 0 }}>{pct}%</span>
                  )}
                  <span className="list-row-meta">
                    {(job.urls as string[])?.length || 0} URLs
                  </span>
                  {job.resultSummary && (
                    <span className="list-row-meta">
                      {(job.resultSummary as any).resultsCount || 0} results
                    </span>
                  )}

                  <span className="list-row-meta" style={{ marginLeft: "auto" }}>
                    {new Date(job.createdAt).toLocaleDateString()}
                  </span>
                </Link>
                <button
                  onClick={() => setDeleteId(job.id)}
                  className="list-row-action"
                  title="Delete job"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteId && (
        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold m-0 mb-3">Delete Scrape Job</h3>
            <p className="text-sm m-0 mb-4" style={{ color: "var(--color-text-muted)" }}>
              This will permanently delete this scrape job and all its results. If it has a per-job database, that container will also be destroyed.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)} className="btn-ghost">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="btn-primary"
                style={{ background: "var(--color-error)" }}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation modal */}
      {showReset && (
        <div className="modal-backdrop" onClick={() => !resetting && setShowReset(false)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold m-0 mb-3" style={{ color: "var(--color-error)" }}>Reset All Data</h3>
            <p className="text-sm m-0 mb-3" style={{ color: "var(--color-text-muted)" }}>
              This will permanently destroy <strong>everything</strong>:
            </p>
            <ul className="text-sm m-0 mb-4 pl-5" style={{ color: "var(--color-text-muted)", lineHeight: "1.8" }}>
              <li>All scrape jobs and their results</li>
              <li>All per-job database containers</li>
              <li>All datasets and dataset rows</li>
              <li>All dashboards and charts</li>
            </ul>
            <p className="text-xs m-0 mb-4" style={{ color: "var(--color-text-muted)" }}>
              The main database and its container will be preserved. IDs will reset to 1.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowReset(false)} disabled={resetting} className="btn-ghost">Cancel</button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="btn-primary"
                style={{ background: "var(--color-error)" }}
              >
                {resetting ? "Resetting..." : "Reset Everything"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
