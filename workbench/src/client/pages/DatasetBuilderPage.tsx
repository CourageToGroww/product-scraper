import React, { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useScrape, useBuildSources, useBuildPreview, useBuildToDataset } from "../lib/hooks";
import { useToast } from "../components/Toast";
import SyntaxBlock from "../components/SyntaxBlock";

type TransformType = "none" | "split" | "regex" | "prefix" | "template";
type FilterOp = "contains" | "not_contains" | "matches" | "not_matches" | "equals" | "not_equals" | "starts_with" | "ends_with";

interface ColumnConfig {
  sourceField: string;
  outputName: string;
  enabled: boolean;
  transformType: TransformType;
  delimiter: string;
  splitIndex: number;
  pattern: string;
  prefix: string;
  template: string;
}

interface FilterConfig {
  id: number;
  field: string;
  operator: FilterOp;
  value: string;
}

interface SourceInfo {
  key: string;
  tableIndex?: number;
  count: number;
  sampleFields: string[];
  sample: Record<string, unknown> | null;
  label: string;
}

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "matches", label: "matches (regex)" },
  { value: "not_matches", label: "not matches (regex)" },
];

const SOURCE_ICONS: Record<string, string> = {
  links: "L", images: "I", tables: "T", headings: "H",
  metadata: "M", emails: "E", phones: "P", videos: "V",
  menus: "N", hashtags: "#"
};

export default function DatasetBuilderPage() {
  const { id } = useParams();
  const jobId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: job, isLoading: jobLoading } = useScrape(jobId);
  const sourcesMutation = useBuildSources();
  const previewMutation = useBuildPreview();
  const saveMutation = useBuildToDataset();

  // Source selection
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceInfo | null>(null);

  // Column config
  const [columns, setColumns] = useState<ColumnConfig[]>([]);

  // Filters
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [nextFilterId, setNextFilterId] = useState(1);

  // Preview
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewStats, setPreviewStats] = useState<{ totalAvailable: number; totalAfterFilter: number } | null>(null);

  // Save
  const [datasetName, setDatasetName] = useState("");
  const [description, setDescription] = useState("");

  // Load sources on mount
  useEffect(() => {
    if (jobId > 0) {
      sourcesMutation.mutate({ jobId }, {
        onSuccess: (data) => setSources(data.sources),
        onError: (err: any) => toast(err.message, "error")
      });
    }
  }, [jobId]);

  // When source is selected, populate columns
  function selectSource(src: SourceInfo) {
    setSelectedSource(src);
    setColumns(src.sampleFields.map(field => ({
      sourceField: field,
      outputName: field,
      enabled: true,
      transformType: "none",
      delimiter: "\\n",
      splitIndex: 0,
      pattern: "(.*)",
      prefix: "",
      template: "{value}"
    })));
    setFilters([]);
    setPreviewRows([]);
    setPreviewStats(null);
  }

  // Build the request config from state
  function buildConfig() {
    const enabledCols = columns.filter(c => c.enabled);
    if (enabledCols.length === 0 || !selectedSource) return null;

    return {
      jobId,
      source: {
        key: selectedSource.key,
        ...(selectedSource.tableIndex != null ? { tableIndex: selectedSource.tableIndex } : {})
      },
      columns: enabledCols.map(c => ({
        sourceField: c.sourceField,
        outputName: c.outputName || c.sourceField,
        ...(c.transformType !== "none" ? {
          transform: {
            type: c.transformType,
            ...(c.transformType === "split" ? { delimiter: c.delimiter.replace(/\\n/g, "\n").replace(/\\t/g, "\t"), index: c.splitIndex } : {}),
            ...(c.transformType === "regex" ? { pattern: c.pattern } : {}),
            ...(c.transformType === "prefix" ? { prefix: c.prefix } : {}),
            ...(c.transformType === "template" ? { template: c.template } : {})
          }
        } : {})
      })),
      filters: filters.map(f => ({
        field: f.field,
        operator: f.operator,
        value: f.value
      }))
    };
  }

  // Debounced preview
  useEffect(() => {
    const config = buildConfig();
    if (!config) return;

    const timer = setTimeout(() => {
      previewMutation.mutate(config as any, {
        onSuccess: (data) => {
          setPreviewRows(data.rows);
          setPreviewStats({ totalAvailable: data.totalAvailable, totalAfterFilter: data.totalAfterFilter });
        },
        onError: (err: any) => {
          toast(err.message, "error");
          setPreviewRows([]);
        }
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedSource, columns, filters]);

  function updateColumn(idx: number, patch: Partial<ColumnConfig>) {
    setColumns(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  function addFilter() {
    const field = columns.find(c => c.enabled)?.sourceField || "";
    setFilters(prev => [...prev, { id: nextFilterId, field, operator: "contains", value: "" }]);
    setNextFilterId(n => n + 1);
  }

  function updateFilter(id: number, patch: Partial<FilterConfig>) {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }

  function removeFilter(id: number) {
    setFilters(prev => prev.filter(f => f.id !== id));
  }

  async function handleSave() {
    const name = datasetName.trim();
    if (!name) { toast("Enter a dataset name", "error"); return; }
    const config = buildConfig();
    if (!config) { toast("Select a source and enable at least one column", "error"); return; }

    try {
      const result = await saveMutation.mutateAsync({
        ...config,
        datasetName: name,
        description: description.trim() || undefined
      } as any);
      toast(`Dataset created with ${result.rowCount} rows`, "success");
      navigate(`/datasets/${result.datasetId}`);
    } catch (err: any) {
      toast(err.message, "error");
    }
  }

  const previewColumns = useMemo(
    () => columns.filter(c => c.enabled).map(c => c.outputName || c.sourceField),
    [columns]
  );

  if (jobLoading) return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="skeleton" style={{ width: "40%", height: "1.5rem" }} />
      <div className="skeleton" style={{ width: "100%", height: "200px" }} />
    </div>
  );

  if (!job) return <p style={{ color: "var(--color-error)" }}>Scrape job not found</p>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Link to={`/scrapes/${id}`} className="text-sm no-underline flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </Link>
        <h1 className="text-lg font-bold m-0" style={{ letterSpacing: "-0.02em" }}>Build Dataset</h1>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>from {job.name}</span>
      </div>

      {/* Step 1: Source Selection */}
      <div className="glass-card mb-3" style={{ padding: "0.75rem" }}>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-muted)" }}>
          1. Select Data Source
        </div>

        {sourcesMutation.isPending && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <div className="spinner" style={{ width: 14, height: 14 }} /> Loading sources...
          </div>
        )}

        {sources.length === 0 && !sourcesMutation.isPending && (
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            No extractable data found. Make sure the scrape captured raw HTML.
          </div>
        )}

        <div style={{ display: "grid", gap: "0.35rem" }}>
          {sources.map((src, i) => {
            const isSelected = selectedSource?.key === src.key && selectedSource?.tableIndex === src.tableIndex;
            return (
              <button
                key={`${src.key}-${src.tableIndex ?? ""}-${i}`}
                onClick={() => selectSource(src)}
                className="text-left border-none cursor-pointer"
                style={{
                  padding: "0.5rem 0.75rem",
                  background: isSelected ? "var(--color-primary-glow-strong)" : "var(--color-surface)",
                  border: `1px solid ${isSelected ? "rgba(6, 182, 212, 0.4)" : "var(--color-border)"}`,
                  transition: "all 0.15s ease"
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-1.5 py-0.5" style={{
                    background: isSelected ? "var(--color-primary)" : "var(--color-surface-glass)",
                    color: isSelected ? "#fff" : "var(--color-text-muted)",
                    fontSize: "0.6rem", minWidth: "18px", textAlign: "center"
                  }}>
                    {SOURCE_ICONS[src.key] || "?"}
                  </span>
                  <span className="text-xs font-medium" style={{ color: isSelected ? "var(--color-primary)" : "var(--color-text)" }}>
                    {src.key === "tables" ? src.label : src.key}
                  </span>
                  <span className="text-xs px-1.5 py-0.5" style={{
                    background: "var(--color-surface-glass)",
                    color: "var(--color-text-muted)",
                    fontSize: "0.6rem"
                  }}>
                    {src.count}
                  </span>
                  <span className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>
                    [{src.sampleFields.join(", ")}]
                  </span>
                </div>
                {isSelected && src.sample && (
                  <div style={{ marginTop: "0.25rem" }}>
                    <SyntaxBlock code={JSON.stringify(src.sample, null, 2).slice(0, 300)} maxHeight="120px" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Column Configuration */}
      {selectedSource && (
        <div className="glass-card mb-3" style={{ padding: "0.75rem" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
              2. Configure Columns
            </div>
            <div className="flex gap-1">
              <button
                className="text-xs border-none bg-transparent cursor-pointer"
                style={{ color: "var(--color-primary)" }}
                onClick={() => setColumns(prev => prev.map(c => ({ ...c, enabled: true })))}
              >All</button>
              <button
                className="text-xs border-none bg-transparent cursor-pointer"
                style={{ color: "var(--color-text-muted)" }}
                onClick={() => setColumns(prev => prev.map(c => ({ ...c, enabled: false })))}
              >None</button>
            </div>
          </div>

          <div style={{ display: "grid", gap: "0.5rem" }}>
            {columns.map((col, idx) => (
              <div key={col.sourceField} style={{
                padding: "0.5rem",
                background: col.enabled ? "var(--color-surface)" : "transparent",
                borderRadius: 0,
                border: `1px solid ${col.enabled ? "var(--color-border)" : "transparent"}`,
                opacity: col.enabled ? 1 : 0.5
              }}>
                {/* Row 1: checkbox, source field, rename */}
                <div className="flex items-center gap-2 flex-wrap" style={{ rowGap: "0.35rem" }}>
                  <input
                    type="checkbox"
                    checked={col.enabled}
                    onChange={e => updateColumn(idx, { enabled: e.target.checked })}
                    style={{ accentColor: "var(--color-primary)", width: 14, height: 14 }}
                  />
                  <span className="text-xs font-mono" style={{
                    color: "var(--color-primary)", minWidth: "60px", fontSize: "0.7rem"
                  }}>
                    {col.sourceField}
                  </span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--color-text-muted)" }}>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <input
                    className="input-field"
                    value={col.outputName}
                    onChange={e => updateColumn(idx, { outputName: e.target.value })}
                    placeholder="Column name"
                    disabled={!col.enabled}
                    style={{ flex: "1 1 100px", fontSize: "0.7rem", padding: "0.25rem 0.5rem", minWidth: "80px", maxWidth: "160px" }}
                  />
                  <select
                    value={col.transformType}
                    onChange={e => updateColumn(idx, { transformType: e.target.value as TransformType })}
                    disabled={!col.enabled}
                    className="input-field"
                    style={{ fontSize: "0.65rem", padding: "0.25rem 0.35rem", width: "auto", minWidth: "70px" }}
                  >
                    <option value="none">No transform</option>
                    <option value="split">Split</option>
                    <option value="regex">Regex</option>
                    <option value="prefix">Prefix</option>
                    <option value="template">Template</option>
                  </select>
                </div>

                {/* Row 2: Transform config (if not "none") */}
                {col.enabled && col.transformType !== "none" && (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap" style={{ paddingLeft: "1.5rem", rowGap: "0.3rem" }}>
                    {col.transformType === "split" && (
                      <>
                        <label className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>delimiter:</label>
                        <input
                          className="input-field"
                          value={col.delimiter}
                          onChange={e => updateColumn(idx, { delimiter: e.target.value })}
                          style={{ width: "60px", fontSize: "0.65rem", padding: "0.2rem 0.35rem" }}
                        />
                        <label className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>part #:</label>
                        <input
                          type="number"
                          className="input-field"
                          value={col.splitIndex}
                          onChange={e => updateColumn(idx, { splitIndex: parseInt(e.target.value) || 0 })}
                          min={0}
                          style={{ width: "45px", fontSize: "0.65rem", padding: "0.2rem 0.35rem" }}
                        />
                      </>
                    )}
                    {col.transformType === "regex" && (
                      <>
                        <label className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>pattern:</label>
                        <input
                          className="input-field font-mono"
                          value={col.pattern}
                          onChange={e => updateColumn(idx, { pattern: e.target.value })}
                          placeholder="(\d+\.?\d*)"
                          style={{ flex: "1 1 120px", fontSize: "0.6rem", padding: "0.2rem 0.35rem" }}
                        />
                      </>
                    )}
                    {col.transformType === "prefix" && (
                      <>
                        <label className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>prefix:</label>
                        <input
                          className="input-field"
                          value={col.prefix}
                          onChange={e => updateColumn(idx, { prefix: e.target.value })}
                          placeholder="https://example.com"
                          style={{ flex: "1 1 150px", fontSize: "0.65rem", padding: "0.2rem 0.35rem" }}
                        />
                      </>
                    )}
                    {col.transformType === "template" && (
                      <>
                        <label className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>template:</label>
                        <input
                          className="input-field font-mono"
                          value={col.template}
                          onChange={e => updateColumn(idx, { template: e.target.value })}
                          placeholder="https://site.com{value}"
                          style={{ flex: "1 1 150px", fontSize: "0.6rem", padding: "0.2rem 0.35rem" }}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 3: Filters */}
      {selectedSource && (
        <div className="glass-card mb-3" style={{ padding: "0.75rem" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
              3. Filter Rows
              {previewStats && (
                <span className="ml-2 px-1.5 py-0.5" style={{
                  background: "var(--color-primary-glow)", color: "var(--color-primary)", fontSize: "0.6rem"
                }}>
                  {previewStats.totalAfterFilter} of {previewStats.totalAvailable}
                </span>
              )}
            </div>
            <button
              onClick={addFilter}
              className="btn-ghost"
              style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem" }}
            >
              + Add Filter
            </button>
          </div>

          {filters.length === 0 && (
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              No filters — all rows will be included.
            </div>
          )}

          <div style={{ display: "grid", gap: "0.35rem" }}>
            {filters.map(f => (
              <div key={f.id} className="flex items-center gap-1.5 flex-wrap" style={{ rowGap: "0.3rem" }}>
                <select
                  value={f.field}
                  onChange={e => updateFilter(f.id, { field: e.target.value })}
                  className="input-field"
                  style={{ fontSize: "0.65rem", padding: "0.25rem 0.35rem", width: "auto", minWidth: "70px" }}
                >
                  {columns.map(c => (
                    <option key={c.sourceField} value={c.sourceField}>{c.sourceField}</option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={e => updateFilter(f.id, { operator: e.target.value as FilterOp })}
                  className="input-field"
                  style={{ fontSize: "0.65rem", padding: "0.25rem 0.35rem", width: "auto", minWidth: "90px" }}
                >
                  {FILTER_OPS.map(op => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
                <input
                  className="input-field"
                  value={f.value}
                  onChange={e => updateFilter(f.id, { value: e.target.value })}
                  placeholder="value"
                  style={{ flex: "1 1 100px", fontSize: "0.65rem", padding: "0.25rem 0.35rem", minWidth: "80px" }}
                />
                <button
                  onClick={() => removeFilter(f.id)}
                  className="btn-ghost"
                  style={{ padding: "0.2rem 0.4rem", fontSize: "0.65rem", color: "var(--color-error)" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {selectedSource && (
        <div className="glass-card mb-3" style={{ padding: "0.75rem" }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
              4. Preview
            </div>
            {previewMutation.isPending && (
              <div className="spinner" style={{ width: 12, height: 12 }} />
            )}
            {previewStats && !previewMutation.isPending && (
              <span className="text-xs px-2 py-0.5" style={{
                background: "var(--color-primary-glow-strong)", color: "var(--color-primary)", fontSize: "0.6rem"
              }}>
                {previewStats.totalAfterFilter} rows match
              </span>
            )}
          </div>

          {previewRows.length > 0 ? (
            <div className="overflow-x-auto" style={{ borderRadius: 0, border: "1px solid var(--color-border)" }}>
              <table className="data-table" style={{ fontSize: "0.65rem" }}>
                <thead>
                  <tr>
                    <th style={{ width: "30px", textAlign: "center", fontSize: "0.55rem" }}>#</th>
                    {previewColumns.map(col => (
                      <th key={col} style={{ whiteSpace: "nowrap" }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row: any, i: number) => (
                    <tr key={i}>
                      <td style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "0.55rem" }}>{i + 1}</td>
                      {previewColumns.map(col => (
                        <td key={col} style={{ maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {row[col] == null ? <span style={{ opacity: 0.3 }}>&mdash;</span> :
                            typeof row[col] === "object" ? JSON.stringify(row[col]).slice(0, 80) :
                            String(row[col]).length > 80 ? String(row[col]).slice(0, 80) + "..." :
                            String(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {previewMutation.isPending ? "Loading preview..." : "Configure columns above to see a preview"}
            </div>
          )}

          {previewStats && previewStats.totalAfterFilter > 20 && (
            <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              Showing 20 of {previewStats.totalAfterFilter} rows
            </div>
          )}
        </div>
      )}

      {/* Step 5: Save */}
      {selectedSource && previewRows.length > 0 && (
        <div className="glass-card" style={{ padding: "0.75rem" }}>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--color-text-muted)" }}>
            5. Save as Dataset
          </div>
          <div className="flex items-end gap-2 flex-wrap" style={{ rowGap: "0.5rem" }}>
            <div style={{ flex: "1 1 180px", minWidth: "150px" }}>
              <label className="text-xs block mb-0.5" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>Name *</label>
              <input
                className="input-field"
                value={datasetName}
                onChange={e => setDatasetName(e.target.value)}
                placeholder="My product links"
                style={{ fontSize: "0.75rem", width: "100%" }}
              />
            </div>
            <div style={{ flex: "1 1 200px", minWidth: "150px" }}>
              <label className="text-xs block mb-0.5" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>Description</label>
              <input
                className="input-field"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional description"
                style={{ fontSize: "0.75rem", width: "100%" }}
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending || !datasetName.trim()}
              className="btn-primary"
              style={{ padding: "0.4rem 1rem", fontSize: "0.75rem", whiteSpace: "nowrap" }}
            >
              {saveMutation.isPending ? "Creating..." : `Create Dataset (${previewStats?.totalAfterFilter ?? 0} rows)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
