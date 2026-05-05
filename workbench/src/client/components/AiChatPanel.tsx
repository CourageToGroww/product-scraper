import React, { useState } from "react";
import { useEditSchema, useEditRoutes } from "../lib/hooks";

interface Props {
  jobId: number;
  target: "schema" | "routes";
  onApplied?: () => void;
}

export default function AiChatPanel({ jobId, target, onApplied }: Props) {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<{ role: "user" | "ai"; content: string }[]>([]);
  const editSchema = useEditSchema();
  const editRoutes = useEditRoutes();

  const isWorking = editSchema.isPending || editRoutes.isPending;
  const placeholder =
    target === "schema"
      ? "Describe schema changes (e.g. 'Add a column tags as text nullable')"
      : "Describe a new route or change (e.g. 'Add an endpoint that lists products with price below a query parameter')";

  async function submit() {
    if (!prompt.trim()) return;
    const p = prompt;
    setHistory((h) => [...h, { role: "user", content: p }]);
    setPrompt("");
    try {
      if (target === "schema") {
        await editSchema.mutateAsync({ jobId, prompt: p });
      } else {
        await editRoutes.mutateAsync({ jobId, prompt: p });
      }
      setHistory((h) => [
        ...h,
        { role: "ai", content: target === "schema" ? "Schema updated." : "Routes updated." },
      ]);
      onApplied?.();
    } catch (err: any) {
      setHistory((h) => [
        ...h,
        { role: "ai", content: `Error: ${err.message ?? String(err)}` },
      ]);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "0.5rem",
        border: "1px solid #ddd",
        padding: "0.5rem",
        borderRadius: "0.25rem",
      }}
    >
      <div style={{ fontWeight: 600 }}>
        AI {target === "schema" ? "Schema" : "Route"} Assistant
      </div>
      <div
        style={{
          minHeight: "4rem",
          maxHeight: "10rem",
          overflow: "auto",
          fontSize: "0.85rem",
          background: "#fafafa",
          padding: "0.5rem",
        }}
      >
        {history.length === 0 && <span style={{ opacity: 0.6 }}>No edits yet.</span>}
        {history.map((m, i) => (
          <div key={i} style={{ marginBottom: "0.25rem" }}>
            <strong>{m.role === "user" ? "You: " : "AI: "}</strong>
            {m.content}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isWorking) submit();
          }}
          disabled={isWorking}
          style={{ flex: 1, padding: "0.4rem", fontSize: "0.85rem" }}
        />
        <button
          onClick={submit}
          disabled={isWorking || !prompt.trim()}
          style={{ padding: "0.4rem 0.75rem" }}
        >
          {isWorking ? "Working..." : "Apply"}
        </button>
      </div>
    </div>
  );
}
