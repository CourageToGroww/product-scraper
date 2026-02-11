import React, { useState } from "react";
import { useDatabases, useCreateDatabase } from "../lib/hooks";
import { useToast } from "../components/Toast";
import { SkeletonCards } from "../components/Skeleton";
import ConfirmModal from "../components/ConfirmModal";
import * as api from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";

export default function DatabasesPage() {
  const { data, isLoading, refetch } = useDatabases();
  const createMutation = useCreateDatabase();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleCreate = async () => {
    if (!newName) return;
    try {
      await createMutation.mutateAsync(newName);
      setNewName("");
      setShowCreate(false);
      toast("Database created", "success");
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const handleAction = async (id: string, action: "start" | "stop" | "export") => {
    setActionLoading(`${id}-${action}`);
    try {
      switch (action) {
        case "start": await api.databases.start(id); toast("Container started", "success"); break;
        case "stop": await api.databases.stop(id); toast("Container stopped", "info"); break;
        case "export": await api.databases.exportDb(id); toast("Database exported", "success"); break;
      }
      refetch();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.databases.delete(deleteTarget);
      toast("Database deleted", "success");
      setDeleteTarget(null);
      refetch();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleConnect = async (id: string) => {
    setActionLoading(`${id}-connect`);
    try {
      await api.databases.connect(id);
      qc.invalidateQueries();
      toast("Connected! All workbench operations now use this database.", "success");
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-2 flex-wrap gap-2">
        <button onClick={() => setShowCreate(!showCreate)} className="btn-ghost">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Container
        </button>
      </div>

      <p className="text-xs mb-2 m-0" style={{ color: "var(--color-text-muted)", maxWidth: "600px" }}>
        Docker containers managed by ScrapeKit. Per-job databases are automatically created when you start a scrape.
        You can also create standalone containers for custom use.
      </p>

      {showCreate && (
        <div className="glass-card p-4 mb-2">
          <div className="flex gap-2 flex-wrap items-end">
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Container Name</label>
              <input className="input-field" value={newName} onChange={e => setNewName(e.target.value)} placeholder="my-database" />
            </div>
            <button onClick={handleCreate} disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending ? "Creating..." : "Create"}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {isLoading && <SkeletonCards count={3} />}

      {!isLoading && data?.databases?.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
            <circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="18" r="1" fill="currentColor" />
          </svg>
          <p className="text-sm m-0 mb-2" style={{ fontWeight: 500 }}>No containers running</p>
          <p className="text-xs m-0">Containers will appear here when you start scraping.</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-1 lg:grid-cols-2">
        {data?.databases?.map((db: any) => (
          <div key={db.id} className="glass-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`status-dot status-dot-${db.status === "running" ? "running" : db.status === "stopped" ? "stopped" : "failed"}`} />
                <span className="font-semibold text-sm">{db.name}</span>
              </div>
              <span className="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>
                :{db.port}
              </span>
            </div>

            <div className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
              Created {new Date(db.createdAt).toLocaleDateString()}
            </div>

            <div className="flex gap-2 flex-wrap">
              {db.status === "stopped" ? (
                <button className="btn-ghost" onClick={() => handleAction(db.id, "start")}
                  disabled={actionLoading === `${db.id}-start`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                  Start
                </button>
              ) : db.status === "running" ? (
                <button className="btn-ghost" onClick={() => handleAction(db.id, "stop")}
                  disabled={actionLoading === `${db.id}-stop`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                  Stop
                </button>
              ) : null}
              {db.status === "running" && (
                <button className="btn-ghost" onClick={() => handleConnect(db.id)}
                  disabled={actionLoading === `${db.id}-connect`}
                  style={{ color: "var(--color-primary)", borderColor: "rgba(6, 182, 212, 0.3)" }}>
                  Connect
                </button>
              )}
              <button className="btn-ghost" onClick={() => handleAction(db.id, "export")}
                disabled={actionLoading === `${db.id}-export`}>
                Export
              </button>
              <button className="btn-danger" onClick={() => setDeleteTarget(db.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Container"
        confirmLabel="Delete Permanently"
        confirmColor="var(--color-error)"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteLoading}
      >
        <p className="m-0">
          This will permanently stop and remove this PostgreSQL container and all its data.
          This action cannot be undone.
        </p>
      </ConfirmModal>
    </div>
  );
}
