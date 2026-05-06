import React from "react";
import { Link } from "react-router-dom";
import { useMerges, useDeleteMerge, useRerunMerge } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function MergeListPage() {
  const { data: rows, isLoading, refetch } = useMerges();
  const del = useDeleteMerge();
  const rerun = useRerunMerge();
  const { toast } = useToast();

  if (isLoading) return <p>Loading...</p>;

  return (
    <div style={{ padding: "1rem", display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Merges</h2>
        <Link to="/merges/new" style={{ padding: "0.4rem 0.75rem", border: "1px solid #ddd", borderRadius: "0.25rem", textDecoration: "none" }}>+ New merge</Link>
      </div>
      {rows && rows.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}>ID</th>
              <th style={cell}>Name</th>
              <th style={cell}>Status</th>
              <th style={cell}>Sources</th>
              <th style={cell}>Created</th>
              <th style={cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td style={cell}>{r.id}</td>
                <td style={cell}>{r.name}</td>
                <td style={cell}>{r.status}{r.errorMessage ? ` - ${r.errorMessage}` : ""}</td>
                <td style={cell}>{(r.sourceDatasetIds as number[]).join(", ")}</td>
                <td style={cell}>{new Date(r.createdAt).toLocaleString()}</td>
                <td style={cell}>
                  <button onClick={async () => { await rerun.mutateAsync(r.id); toast("Re-run started", "info"); refetch(); }} style={{ marginRight: "0.5rem" }}>Re-run</button>
                  <button onClick={async () => { await del.mutateAsync(r.id); toast("Deleted", "info"); refetch(); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{ opacity: 0.7 }}>No merges yet.</p>}
    </div>
  );
}

const cell: React.CSSProperties = { padding: "0.25rem 0.5rem", textAlign: "left", borderBottom: "1px solid #eee", fontSize: "0.85rem" };
