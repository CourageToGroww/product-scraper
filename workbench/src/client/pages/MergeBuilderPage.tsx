import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDatasets, useCreateMerge } from "../lib/hooks";
import { useToast } from "../components/Toast";

export default function MergeBuilderPage() {
  const { data: datasetsResp, isLoading } = useDatasets();
  const create = useCreateMerge();
  const nav = useNavigate();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  if (isLoading) return <p>Loading...</p>;

  const datasets = (datasetsResp as any)?.datasets ?? [];

  function toggle(id: number) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) return toast("Name is required", "error");
    if (picked.size < 2) return toast("Pick at least 2 datasets", "error");
    try {
      const result = await create.mutateAsync({
        name, description: description.trim() || undefined,
        sourceDatasetIds: Array.from(picked)
      });
      toast(`Merge ${result.id} started`, "success");
      nav("/merges");
    } catch (err: any) {
      toast(`Merge failed: ${err.message ?? String(err)}`, "error");
    }
  }

  return (
    <div style={{ padding: "1rem", display: "grid", gap: "1rem", maxWidth: "640px" }}>
      <h2 style={{ margin: 0 }}>New merge</h2>
      <label>
        Name<br />
        <input value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "0.4rem" }} />
      </label>
      <label>
        Description (optional)<br />
        <input value={description} onChange={e => setDescription(e.target.value)} style={{ width: "100%", padding: "0.4rem" }} />
      </label>
      <div>
        <strong>Pick source datasets (need at least 2 with running DBs):</strong>
        <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0" }}>
          {datasets.map((d: any) => (
            <li key={d.id} style={{ padding: "0.25rem 0" }}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: d.databaseStatus === "running" ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  disabled={d.databaseStatus !== "running"}
                  checked={picked.has(d.id)}
                  onChange={() => toggle(d.id)}
                />
                #{d.id} - {d.name} ({d.databaseStatus})
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <button onClick={submit} disabled={create.isPending} style={{ padding: "0.4rem 0.75rem" }}>
          {create.isPending ? "Starting..." : "Start merge"}
        </button>
      </div>
    </div>
  );
}
