import React from "react";

export default function SchemaViewer({
  schemaSpec,
  schemaSource,
}: {
  schemaSpec: any | null;
  schemaSource: string | null;
}) {
  if (!schemaSpec)
    return (
      <p style={{ opacity: 0.7 }}>No schema generated yet. Run the pipeline first.</p>
    );

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>Tables</h3>
        {schemaSpec.tables.map((table: any) => (
          <div
            key={table.name}
            style={{
              marginBottom: "1rem",
              padding: "0.5rem",
              border: "1px solid #ddd",
              borderRadius: "0.25rem",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{table.name}</div>
            <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={cell}>Column</th>
                  <th style={cell}>Type</th>
                  <th style={cell}>Nullable</th>
                  <th style={cell}>Description</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((c: any) => (
                  <tr key={c.name}>
                    <td style={cell}>{c.name}</td>
                    <td style={cell}>
                      <code>{c.type}</code>
                    </td>
                    <td style={cell}>{c.nullable ? "yes" : "no"}</td>
                    <td style={{ ...cell, color: "#666" }}>{c.description || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {schemaSource && (
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Drizzle TS source</summary>
          <pre
            style={{
              background: "#f5f5f5",
              padding: "0.5rem",
              overflow: "auto",
              fontSize: "0.8rem",
            }}
          >
            {schemaSource}
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
