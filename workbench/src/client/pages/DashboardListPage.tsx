import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useDashboards, useCreateDashboard, useDeleteDashboard } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function DashboardListPage() {
  const { data, isLoading } = useDashboards();
  const createMutation = useCreateDashboard();
  const deleteMutation = useDeleteDashboard();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!newName) return;
    await createMutation.mutateAsync({ name: newName });
    setNewName("");
    setShowCreate(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync(deleteId);
      toast("Dashboard deleted", "success");
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
          New Dashboard
        </button>
      </div>

      {showCreate && (
        <div className="glass-card p-4 mb-2">
          <div className="flex gap-2 flex-wrap items-end">
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Dashboard Name</label>
              <input className="input-field" value={newName} onChange={e => setNewName(e.target.value)} placeholder="My Dashboard" />
            </div>
            <button onClick={handleCreate} disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending ? "Creating..." : "Create"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="glass-card overflow-hidden">
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: "2.25rem", borderRadius: 0 }} />)}
        </div>
      )}

      {!isLoading && data?.dashboards?.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <p className="text-sm m-0 mb-2" style={{ fontWeight: 500 }}>No dashboards yet</p>
          <p className="text-xs m-0">Create one to start visualizing your data.</p>
        </div>
      )}

      {!isLoading && data?.dashboards && data.dashboards.length > 0 && (
        <div className="glass-card overflow-hidden">
          {data.dashboards.map((d: any, i: number) => (
            <div
              key={d.id}
              className="list-row"
              style={{ borderTop: i > 0 ? "1px solid var(--color-border)" : "none" }}
            >
              <Link to={`/dashboards/${d.id}`} className="list-row-link">
                <span className="font-semibold text-sm" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                <span className="list-row-meta">{d.charts?.length || 0} charts</span>
                <span className="list-row-meta" style={{ marginLeft: "auto" }}>
                  {new Date(d.createdAt).toLocaleDateString()}
                </span>
              </Link>
              <button
                onClick={() => setDeleteId(d.id)}
                className="list-row-action"
                title="Delete dashboard"
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
            <h3 className="text-base font-bold m-0 mb-3">Delete Dashboard</h3>
            <p className="text-sm m-0 mb-4" style={{ color: "var(--color-text-muted)" }}>
              This will permanently delete this dashboard and all its charts.
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
