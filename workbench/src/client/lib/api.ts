const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Scrapes
export const scrapes = {
  list: (limit = 20, offset = 0) =>
    request<{ jobs: any[]; limit: number; offset: number }>(`/scrapes?limit=${limit}&offset=${offset}`),
  get: (id: number) => request<any>(`/scrapes/${id}`),
  create: (data: {
    name: string;
    urls: string[];
    type?: "api" | "web";
    options?: any;
    scrapeOpts?: any;
    extractionConfig?: { mode: string; config: Record<string, unknown>; datasetName?: string };
    headers?: Record<string, string>;
    delay?: number;
    timeout?: number;
  }) => request<any>("/scrapes", { method: "POST", body: JSON.stringify(data) }),
  apiDetect: (data: { url: string; headers?: Record<string, string> }) =>
    request<{
      detected: boolean; totalItems?: number; itemsKey?: string; itemsPerPage?: number;
      totalPages?: number; pageParam?: string; suggestedPattern?: string; sample?: unknown;
      responseType: string; responseKeys?: string[]
    }>("/scrapes/api-detect", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: number) => request<any>(`/scrapes/${id}`, { method: "DELETE" }),
  reset: () => request<{ reset: boolean; containersRemoved: number; errors?: string[] }>("/scrapes/reset", { method: "POST" }),
  discover: (data: { url: string; method?: string; maxUrls?: number; maxDepth?: number; pathPrefix?: string; jsRender?: boolean }) =>
    request<{ urls: string[]; method: string; count: number }>("/scrapes/discover", { method: "POST", body: JSON.stringify(data) })
};

// Datasets
export const datasets = {
  list: (limit = 20, offset = 0) =>
    request<{ datasets: any[]; limit: number; offset: number }>(`/datasets?limit=${limit}&offset=${offset}`),
  get: (id: number) => request<any>(`/datasets/${id}`),
  create: (data: { name: string; description?: string; sourceJobId?: number; rows?: any[] }) =>
    request<any>("/datasets", { method: "POST", body: JSON.stringify(data) }),
  getRows: (id: number, limit = 50, offset = 0, search?: string) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (search) params.set("search", search);
    return request<{ rows: any[]; totalFiltered: number; limit: number; offset: number }>(`/datasets/${id}/rows?${params}`);
  },
  exportUrl: (id: number, format: "csv" | "json" | "jsonl") =>
    `${BASE_URL}/datasets/${id}/export?format=${format}`,
  snippet: (id: number, lang: "python" | "node" | "curl") =>
    request<{ code: string; lang: string }>(`/datasets/${id}/snippet?lang=${lang}`),
  update: (id: number, data: { name?: string; description?: string }) =>
    request<any>(`/datasets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: number) => request<any>(`/datasets/${id}`, { method: "DELETE" }),
  spawnDatabase: (id: number) => request<any>(`/datasets/${id}/database/spawn`, { method: "POST" }),
  exportDatabase: (id: number) => request<any>(`/datasets/${id}/database/export`, { method: "POST" }),
  deleteDatabase: (id: number) => request<any>(`/datasets/${id}/database`, { method: "DELETE" })
};

// Dashboards
export const dashboards = {
  list: () => request<{ dashboards: any[] }>("/dashboards"),
  get: (id: number) => request<any>(`/dashboards/${id}`),
  create: (data: { name: string; description?: string }) =>
    request<any>("/dashboards", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: any) =>
    request<any>(`/dashboards/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: number) => request<any>(`/dashboards/${id}`, { method: "DELETE" }),
  addChart: (dashboardId: number, data: any) =>
    request<any>(`/dashboards/${dashboardId}/charts`, { method: "POST", body: JSON.stringify(data) }),
  updateChart: (chartId: number, data: any) =>
    request<any>(`/dashboards/charts/${chartId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteChart: (chartId: number) =>
    request<any>(`/dashboards/charts/${chartId}`, { method: "DELETE" })
};

// Extraction
export const extract = {
  preview: (data: { jobId: number; resultId?: number; mode: string; config: Record<string, unknown> }) =>
    request<{ url: string; data: any }>("/extract/preview", { method: "POST", body: JSON.stringify(data) }),
  batch: (data: { jobId: number; mode: string; config: Record<string, unknown> }) =>
    request<{ results: { url: string; data: any }[]; totalResults: number; extractedCount: number; skippedNoHtml: number; errors?: { url: string; error: string }[] }>("/extract/batch", { method: "POST", body: JSON.stringify(data) }),
  toDataset: (data: { jobId: number; mode: string; config: Record<string, unknown>; datasetName: string }) =>
    request<{ datasetId: number; rowCount: number }>("/extract/to-dataset", { method: "POST", body: JSON.stringify(data) }),
  singleToDataset: (data: { jobId: number; resultId: number; mode: string; config: Record<string, unknown>; datasetName: string }) =>
    request<{ datasetId: number; rowCount: number }>("/extract/single-to-dataset", { method: "POST", body: JSON.stringify(data) }),
  buildSources: (data: { jobId: number; resultId?: number }) =>
    request<{ sources: any[]; resultUrl: string; resultCount: number }>("/extract/build-sources", { method: "POST", body: JSON.stringify(data) }),
  buildPreview: (data: { jobId: number; resultId?: number; source: { key: string; tableIndex?: number }; columns: any[]; filters?: any[] }) =>
    request<{ rows: any[]; totalAvailable: number; totalAfterFilter: number; previewCount: number }>("/extract/build-preview", { method: "POST", body: JSON.stringify(data) }),
  buildToDataset: (data: { jobId: number; resultId?: number; source: { key: string; tableIndex?: number }; columns: any[]; filters?: any[]; datasetName: string; description?: string }) =>
    request<{ datasetId: number; rowCount: number }>("/extract/build-to-dataset", { method: "POST", body: JSON.stringify(data) }),
  autoDetect: (data: { jobId: number; resultId?: number }) =>
    request<{ type: string; confidence: number; suggestedConfig?: { mode: string; config: Record<string, unknown> }; signals?: Record<string, unknown> }>("/extract/auto-detect", { method: "POST", body: JSON.stringify(data) }),
  autoparseCategoryToDataset: (data: { jobId: number; resultId: number; category: string; tableIndex?: number; datasetName: string }) =>
    request<{ datasetId: number; rowCount: number }>("/extract/autoparse-to-dataset", { method: "POST", body: JSON.stringify(data) })
};

// Images
export const images = {
  proxyUrl: (url: string) => `${BASE_URL}/images/proxy?url=${encodeURIComponent(url)}`,
  precache: (jobId: number) =>
    request<{ total: number; cached: number; failed: number }>("/images/precache", {
      method: "POST",
      body: JSON.stringify({ jobId })
    })
};

// Settings
export const settings = {
  get: () =>
    request<{
      aiProvider: string | null;
      aiAutoparse: boolean;
      aiParseMode: string;
      parseModes: { value: string; label: string; description: string }[];
      claudeApiKey: string | null;
      openaiApiKey: string | null;
      geminiApiKey: string | null;
      deepseekApiKey: string | null;
      kimiApiKey: string | null;
    }>("/settings"),
  update: (data: {
    aiProvider?: string | null;
    aiAutoparse?: boolean;
    aiParseMode?: string;
    claudeApiKey?: string;
    openaiApiKey?: string;
    geminiApiKey?: string;
    deepseekApiKey?: string;
    kimiApiKey?: string;
  }) => request<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify(data) })
}

export const pipelines = {
  runs: (jobId: number) => request<any[]>(`/ai/jobs/${jobId}/pipeline`),
  getRun: (id: number) => request<any>(`/ai/pipeline-runs/${id}`),
  artifacts: (jobId: number) => request<{
    schemaSpec: any | null;
    routeSet: any | null;
    routeSource: string | null;
    schemaSource: string | null;
    honoServices: any[];
  }>(`/ai/jobs/${jobId}/artifacts`),
  start: (jobId: number, data: { mode?: string } = {}) =>
    request<any>(`/ai/jobs/${jobId}/pipeline`, { method: "POST", body: JSON.stringify(data) }),
  rerun: (jobId: number, phase: "schema" | "data" | "api") =>
    request<any>(`/ai/jobs/${jobId}/pipeline/${phase}/rerun`, { method: "POST", body: JSON.stringify({}) }),
  editSchema: (jobId: number, prompt: string) =>
    request<{ schemaSpec: any; schemaSource: string }>(`/ai/jobs/${jobId}/edit-schema`, { method: "POST", body: JSON.stringify({ prompt }) }),
  editRoutes: (jobId: number, prompt: string) =>
    request<{ routeSet: any; routeSource: string }>(`/ai/jobs/${jobId}/edit-routes`, { method: "POST", body: JSON.stringify({ prompt }) }),
  rebuild: (jobId: number) =>
    request<{ honoServiceId: number; port: number }>(`/ai/jobs/${jobId}/rebuild`, { method: "POST", body: JSON.stringify({}) }),
  destroyApi: (jobId: number) =>
    request<{ ok: boolean; services: number; datasetCleaned: boolean; diskCleaned: boolean }>(`/ai/jobs/${jobId}/api`, { method: "DELETE" }),
  studioLaunch: (jobId: number) =>
    request<{ url: string; port: number }>(`/ai/jobs/${jobId}/studio/launch`, { method: "POST", body: JSON.stringify({}) })
};;

// AI Parse
export const aiParse = {
  run: (params: { jobId: number; mode?: string }) =>
    request<{ datasetId: number; rowCount: number }>("/settings/ai-parse", {
      method: "POST",
      body: JSON.stringify(params)
    })
};

// Databases
export const databases = {
  list: () => request<{ databases: any[] }>("/databases"),
  create: (name: string) => request<any>("/databases", { method: "POST", body: JSON.stringify({ name }) }),
  start: (id: string) => request<any>(`/databases/${id}/start`, { method: "POST" }),
  stop: (id: string) => request<any>(`/databases/${id}/stop`, { method: "POST" }),
  exportDb: (id: string) => request<any>(`/databases/${id}/export`, { method: "POST" }),
  importDb: (path: string, name: string) =>
    request<any>("/databases/import", { method: "POST", body: JSON.stringify({ path, name }) }),
  delete: (id: string) => request<any>(`/databases/${id}`, { method: "DELETE" }),
  studio: (id: string) => request<any>(`/databases/${id}/studio`),
  connect: (id: string) => request<any>(`/databases/${id}/connect`, { method: "POST" })
};

export const exports_ = {
  build: (jobId: number) => request<{ dir: string; jobId: number; size: number }>(`/ai/jobs/${jobId}/export-bundle`, { method: "POST", body: JSON.stringify({}) }),
  downloadUrl: (jobId: number) => `/api/ai/jobs/${jobId}/export-bundle/download`
};

export const merges = {
  list: () => request<any[]>("/merges"),
  get: (id: number) => request<any>(`/merges/${id}`),
  create: (data: { name: string; description?: string; sourceDatasetIds: number[] }) =>
    request<any>("/merges", { method: "POST", body: JSON.stringify(data) }),
  rerun: (id: number) => request<{ ok: boolean }>(`/merges/${id}/rerun`, { method: "POST", body: JSON.stringify({}) }),
  delete: (id: number) => request<{ ok: boolean }>(`/merges/${id}`, { method: "DELETE" })
};
