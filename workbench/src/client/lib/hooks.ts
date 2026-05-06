import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";

// Scrapes
export function useScrapes(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ["scrapes", limit, offset],
    queryFn: () => api.scrapes.list(limit, offset),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs;
      if (jobs?.some((j: any) => j.status === "pending" || j.status === "running")) return 2000;
      return false;
    }
  });
}

export function useScrape(id: number) {
  return useQuery({
    queryKey: ["scrapes", id],
    queryFn: () => api.scrapes.get(id),
    enabled: id > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "pending" || status === "running") return 2000;
      return false;
    }
  });
}

export function useCreateScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.scrapes.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scrapes"] })
  });
}

export function useDeleteScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.scrapes.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scrapes"] })
  });
}

// Datasets
export function useDatasets(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ["datasets", limit, offset],
    queryFn: () => api.datasets.list(limit, offset)
  });
}

export function useDataset(id: number) {
  return useQuery({
    queryKey: ["datasets", id],
    queryFn: () => api.datasets.get(id),
    enabled: id > 0
  });
}

export function useDatasetRows(id: number, limit = 50, offset = 0, search?: string) {
  return useQuery({
    queryKey: ["datasets", id, "rows", limit, offset, search],
    queryFn: () => api.datasets.getRows(id, limit, offset, search),
    enabled: id > 0
  });
}

export function useDatasetSnippet(id: number, lang: "python" | "node" | "curl") {
  return useQuery({
    queryKey: ["datasets", id, "snippet", lang],
    queryFn: () => api.datasets.snippet(id, lang),
    enabled: id > 0
  });
}

export function useCreateDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.datasets.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

export function useDeleteDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.datasets.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

// Dashboards
export function useDashboards() {
  return useQuery({
    queryKey: ["dashboards"],
    queryFn: api.dashboards.list
  });
}

export function useDashboard(id: number) {
  return useQuery({
    queryKey: ["dashboards", id],
    queryFn: () => api.dashboards.get(id),
    enabled: id > 0
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.dashboards.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] })
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.dashboards.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] })
  });
}

// Extraction
export function useExtractPreview() {
  return useMutation({
    mutationFn: api.extract.preview
  });
}

export function useExtractToDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.extract.toDataset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

export function useExtractSingleToDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.extract.singleToDataset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

export function useBuildSources() {
  return useMutation({ mutationFn: api.extract.buildSources });
}

export function useBuildPreview() {
  return useMutation({ mutationFn: api.extract.buildPreview });
}

export function useBuildToDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.extract.buildToDataset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

export function useAutoDetect() {
  return useMutation({ mutationFn: api.extract.autoDetect });
}

export function useAutoparseCategoryToDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.extract.autoparseCategoryToDataset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

export function useSpawnDatasetDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.datasets.spawnDatabase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

export function useExportDatasetDatabase() {
  return useMutation({ mutationFn: (id: number) => api.datasets.exportDatabase(id) });
}

export function useDeleteDatasetDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.datasets.deleteDatabase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

// Settings
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: api.settings.get
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.settings.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] })
  });
}

// AI Parse
export function useAiParse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { jobId: number; mode?: string }) => api.aiParse.run(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["datasets"] })
  });
}

// Databases
export function useDatabases() {
  return useQuery({
    queryKey: ["databases"],
    queryFn: api.databases.list
  });
}

export function useCreateDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.databases.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["databases"] })
  });
}

// Pipelines
export function usePipelineRuns(jobId: number) {
  return useQuery({
    queryKey: ["pipeline-runs", jobId],
    queryFn: () => api.pipelines.runs(jobId),
    enabled: jobId > 0
  });
}

export function useArtifacts(jobId: number) {
  return useQuery({
    queryKey: ["job-artifacts", jobId],
    queryFn: () => api.pipelines.artifacts(jobId),
    enabled: jobId > 0
  });
}

export function useStartPipeline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, mode }: { jobId: number; mode?: string }) =>
      api.pipelines.start(jobId, { mode }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["pipeline-runs", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["job-artifacts", vars.jobId] });
    }
  });
}

export function useEditSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, prompt }: { jobId: number; prompt: string }) =>
      api.pipelines.editSchema(jobId, prompt),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["job-artifacts", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["pipeline-runs", vars.jobId] });
    }
  });
}

export function useEditRoutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, prompt }: { jobId: number; prompt: string }) =>
      api.pipelines.editRoutes(jobId, prompt),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["job-artifacts", vars.jobId] });
      qc.invalidateQueries({ queryKey: ["pipeline-runs", vars.jobId] });
    }
  });
}

export function useRebuildApi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) => api.pipelines.rebuild(jobId),
    onSuccess: (_data, jobId) => {
      qc.invalidateQueries({ queryKey: ["job-artifacts", jobId] });
    }
  });
}

export function useStudioLaunch() {
  return useMutation({
    mutationFn: (jobId: number) => api.pipelines.studioLaunch(jobId)
  });
}

export function useBuildExportBundle() {
  return useMutation({ mutationFn: (jobId: number) => api.exports_.build(jobId) });
}

export function useMerges() {
  return useQuery({ queryKey: ["merges"], queryFn: () => api.merges.list() });
}

export function useMerge(id: number) {
  return useQuery({ queryKey: ["merge", id], queryFn: () => api.merges.get(id), enabled: id > 0 });
}

export function useCreateMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; sourceDatasetIds: number[] }) => api.merges.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merges"] })
  });
}

export function useRerunMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.merges.rerun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merges"] })
  });
}

export function useDeleteMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.merges.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["merges"] })
  });
}
