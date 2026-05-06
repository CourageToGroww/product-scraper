import React from "react";
import { useBuildExportBundle } from "../lib/hooks";
import { useToast } from "./Toast";

export default function ExportBundleButton({ jobId }: { jobId: number }) {
  const build = useBuildExportBundle();
  const { toast } = useToast();

  async function handleBuild() {
    try {
      const result = await build.mutateAsync(jobId);
      toast(`Bundle built (${(result.size / 1024).toFixed(1)} KB) at ${result.dir}`, "success");
    } catch (err: any) {
      toast(`Bundle build failed: ${err.message ?? String(err)}`, "error");
    }
  }

  return (
    <div style={{ display: "inline-flex", gap: "0.5rem" }}>
      <button onClick={handleBuild} disabled={build.isPending} style={{ padding: "0.4rem 0.75rem" }}>
        {build.isPending ? "Building..." : "Build export bundle"}
      </button>
      <a
        href={`/api/ai/jobs/${jobId}/export-bundle/download`}
        download
        style={{ padding: "0.4rem 0.75rem", border: "1px solid #ddd", borderRadius: "0.25rem", textDecoration: "none" }}
      >
        Download .tar.gz
      </a>
    </div>
  );
}
