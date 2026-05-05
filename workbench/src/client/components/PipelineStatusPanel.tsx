import React from "react";
import { usePipelineRuns } from "../lib/hooks";

export default function PipelineStatusPanel({ jobId }: { jobId: number }) {
  const { data: runs, isLoading } = usePipelineRuns(jobId);

  if (isLoading) return <p>Loading pipeline status...</p>;
  if (!runs || runs.length === 0) return <p style={{ opacity: 0.7 }}>No pipeline runs yet.</p>;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <h3 style={{ margin: 0 }}>Pipeline runs</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={cell}>ID</th>
            <th style={cell}>Phase</th>
            <th style={cell}>Status</th>
            <th style={cell}>Provider</th>
            <th style={cell}>Started</th>
            <th style={cell}>Duration</th>
            <th style={cell}>Error</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r: any) => {
            const dur =
              r.completedAt && r.startedAt
                ? `${Math.round(
                    (new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000
                  )}s`
                : "-";
            return (
              <tr key={r.id}>
                <td style={cell}>{r.id}</td>
                <td style={cell}>{r.phase}</td>
                <td style={cell}>
                  <StatusBadge status={r.status} />
                </td>
                <td style={cell}>{r.provider}</td>
                <td style={cell}>
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : "-"}
                </td>
                <td style={cell}>{dur}</td>
                <td style={{ ...cell, color: "var(--color-error, crimson)" }}>
                  {r.errorMessage || ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  fontSize: "0.85rem",
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "#3b82f6",
    completed: "#10b981",
    failed: "#ef4444",
    pending: "#9ca3af",
  };
  return (
    <span
      style={{
        background: colors[status] || "#9ca3af",
        color: "white",
        padding: "0.1rem 0.4rem",
        borderRadius: "0.25rem",
        fontSize: "0.75rem",
      }}
    >
      {status}
    </span>
  );
}
