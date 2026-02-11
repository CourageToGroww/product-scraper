import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useDatasets, useCreateDataset, useDeleteDataset, useScrapes } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { SkeletonCards } from "../components/Skeleton";

export default function DatasetListPage() {
  const { data, isLoading } = useDatasets();
  const { data: scrapeData } = useScrapes();
  const createMutation = useCreateDataset();
  const deleteMutation = useDeleteDataset();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [sourceJobId, setSourceJobId] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!newName) return;
    await createMutation.mutateAsync({
      name: newName,
      sourceJobId: sourceJobId ? Number(sourceJobId) : undefined
    });
    setNewName("");
    setSourceJobId("");
    setShowCreate(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast("Dataset deleted", "success");
    } catch (err: any) {
      toast(err.message, "error");
    }
    setDeleteId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-2 flex-wrap gap-2">
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Dataset
        </button>
      </div>

      {showCreate && (
        <div className="glass-card p-4 mb-2">
          <div className="flex gap-2 flex-wrap items-end">
            <div style={{ flex: 1, minWidth: "160px" }}>
              <input className="input-field" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Dataset name" />
            </div>
            <div style={{ flex: 1, minWidth: "160px" }}>
              <select className="input-field" value={sourceJobId} onChange={e => setSourceJobId(e.target.value)}>
                <option value="">Manual (no source)</option>
                {scrapeData?.jobs?.filter((j: any) => j.status === "completed").map((j: any) => (
                  <option key={j.id} value={j.id}>From: {j.name}</option>
                ))}
              </select>
            </div>
            <button onClick={handleCreate} className="btn-primary">Create</button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="glass-card overflow-hidden">
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: "2.25rem", borderRadius: 0 }} />)}
        </div>
      )}

      {!isLoading && data?.datasets?.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <p className="text-sm m-0 mb-2" style={{ fontWeight: 500 }}>No datasets yet</p>
          <p className="text-xs m-0">Create one from a completed scrape job.</p>
        </div>
      )}

      {!isLoading && data?.datasets && data.datasets.length > 0 && (
        <div className="glass-card overflow-hidden">
          {data.datasets.map((ds: any, i: number) => (
            <div
              key={ds.id}
              className="list-row"
              style={{ borderTop: i > 0 ? "1px solid var(--color-border)" : "none" }}
            >
              <Link to={`/datasets/${ds.id}`} className="list-row-link">
                <span className="font-semibold text-sm" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ds.name}</span>
                <span className="list-row-meta">{ds.rowCount} rows</span>
                <span className="list-row-meta" style={{ marginLeft: "auto" }}>
                  {new Date(ds.createdAt).toLocaleDateString()}
                </span>
              </Link>
              <button
                onClick={() => setDeleteId(ds.id)}
                className="list-row-action"
                title="Delete dataset"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteId && (
        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold m-0 mb-3">Delete Dataset</h3>
            <p className="text-sm m-0 mb-4" style={{ color: "var(--color-text-muted)" }}>
              This will permanently delete this dataset and all its rows.
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
    </div>
  );
}
