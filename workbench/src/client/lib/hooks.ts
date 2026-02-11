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
