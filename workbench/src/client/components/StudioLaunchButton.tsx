import React from "react";
import { useStudioLaunch } from "../lib/hooks";
import { useToast } from "./Toast";

export default function StudioLaunchButton({ jobId }: { jobId: number }) {
  const launch = useStudioLaunch();
  const { toast } = useToast();

  async function handleClick() {
    try {
      const result = await launch.mutateAsync(jobId);
      toast(`Studio starting on port ${result.port}`, "info");
      setTimeout(() => window.open(result.url, "_blank"), 1500);
    } catch (err: any) {
      toast(`Studio launch failed: ${err.message ?? String(err)}`, "error");
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={launch.isPending}
      style={{ padding: "0.4rem 0.75rem" }}
    >
      {launch.isPending ? "Launching..." : "Open in Drizzle Studio"}
    </button>
  );
}
