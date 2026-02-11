import React from "react";

export function SkeletonLine({ width = "100%", height = "0.75rem" }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function SkeletonCard() {
  return (
    <div className="glass-card p-4" style={{ display: "grid", gap: "0.75rem" }}>
      <SkeletonLine width="60%" height="1rem" />
      <SkeletonLine width="40%" />
      <SkeletonLine width="80%" />
    </div>
  );
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass-card overflow-hidden">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "0.75rem", padding: "0.75rem" }}>
        {Array.from({ length: cols }, (_, i) => <SkeletonLine key={i} width="60%" height="0.625rem" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{
          display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: "0.75rem", padding: "0.625rem 0.75rem",
          borderTop: "1px solid var(--color-border)"
        }}>
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonLine key={c} width={c === 0 ? "80%" : "50%"} />
          ))}
        </div>
      ))}
    </div>
  );
}
