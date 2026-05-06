import React from "react";
import { useParams, Link } from "react-router-dom";
import { useArtifacts, useRebuildApi, useStartPipeline } from "../lib/hooks";
import { useToast } from "../components/Toast";
import PipelineStatusPanel from "../components/PipelineStatusPanel";
import SchemaViewer from "../components/SchemaViewer";
import RouteEditor from "../components/RouteEditor";
import AiChatPanel from "../components/AiChatPanel";
import StudioLaunchButton from "../components/StudioLaunchButton";
import ExportBundleButton from "../components/ExportBundleButton";

export default function JobApiPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const { data, isLoading, refetch } = useArtifacts(jobId);
  const rebuild = useRebuildApi();
  const startPipeline = useStartPipeline();
  const { toast } = useToast();

  if (isLoading) return <p>Loading...</p>;

  async function handleRunPipeline() {
    try { await startPipeline.mutateAsync({ jobId }); toast("Pipeline started", "success"); refetch(); }
    catch (err: any) { toast(`Pipeline failed: ${err.message}`, "error"); }
  }
  async function handleRebuild() {
    try {
      const result = await rebuild.mutateAsync(jobId);
      toast(`API rebuilt - http://localhost:${result.port}`, "success");
      refetch();
    } catch (err: any) { toast(`Rebuild failed: ${err.message}`, "error"); }
  }

  return (
    <div style={{ display: "grid", gap: "1rem", padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Job #{jobId} - AI Pipeline</h2>
        <Link to={`/scrapes/${jobId}`}>Back to scrape</Link>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={handleRunPipeline} disabled={startPipeline.isPending} style={{ padding: "0.4rem 0.75rem" }}>
          {startPipeline.isPending ? "Running..." : "Run pipeline"}
        </button>
        <button onClick={handleRebuild} disabled={rebuild.isPending} style={{ padding: "0.4rem 0.75rem" }}>
          {rebuild.isPending ? "Rebuilding..." : "Rebuild API service"}
        </button>
        <StudioLaunchButton jobId={jobId} />
        <ExportBundleButton jobId={jobId} />
      </div>

      <PipelineStatusPanel jobId={jobId} />

      <section style={{ display: "grid", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Schema</h3>
        <SchemaViewer schemaSpec={data?.schemaSpec ?? null} schemaSource={data?.schemaSource ?? null} />
        <AiChatPanel jobId={jobId} target="schema" onApplied={() => refetch()} />
      </section>

      <section style={{ display: "grid", gap: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Routes</h3>
        <RouteEditor routeSet={data?.routeSet ?? null} routeSource={data?.routeSource ?? null} />
        <AiChatPanel jobId={jobId} target="routes" onApplied={() => refetch()} />
      </section>

      {data?.honoServices && data.honoServices.length > 0 && (
        <section>
          <h3 style={{ margin: 0 }}>API services</h3>
          <ul>
            {data.honoServices.map((s: any) => (
              <li key={s.id}>
                Service #{s.id} - port {s.port} - status: {s.status} - image: <code>{s.imageTag}</code>
                {s.status === "running" && (
                  <> - <a href={`http://localhost:${s.port}/health`} target="_blank" rel="noreferrer">health</a></>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
