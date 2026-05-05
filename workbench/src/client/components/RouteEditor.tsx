import React from "react";

export default function RouteEditor({
  routeSet,
  routeSource,
}: {
  routeSet: any | null;
  routeSource: string | null;
}) {
  if (!routeSet)
    return (
      <p style={{ opacity: 0.7 }}>No routes generated yet. Run the pipeline first.</p>
    );

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>
          Routes (resource: <code>{routeSet.resource}</code>)
        </h3>
        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={cell}>Method</th>
              <th style={cell}>Path</th>
              <th style={cell}>Description</th>
            </tr>
          </thead>
          <tbody>
            {routeSet.routes.map((r: any, i: number) => (
              <tr key={i}>
                <td style={cell}>
                  <strong>{r.method}</strong>
                </td>
                <td style={cell}>
                  <code>
                    /{routeSet.resource}
                    {r.path}
                  </code>
                </td>
                <td style={cell}>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {routeSource && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hono TS source</summary>
          <pre
            style={{
              background: "#f5f5f5",
              padding: "0.5rem",
              overflow: "auto",
              fontSize: "0.8rem",
            }}
          >
            {routeSource}
          </pre>
        </details>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  textAlign: "left",
  borderBottom: "1px solid #eee",
};
