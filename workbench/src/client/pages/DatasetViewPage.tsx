import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useDataset, useDatasetRows, useDatasetSnippet, useSpawnDatasetDatabase, useExportDatasetDatabase, useDeleteDatasetDatabase } from "../lib/hooks";
import { useToast } from "../components/Toast";
import SyntaxBlock from "../components/SyntaxBlock";
import ConfirmModal from "../components/ConfirmModal";
import * as api from "../lib/api";

const TRUNCATE_LEN = 120;
const WIDE_COLUMNS = new Set(["url", "content", "description", "headings", "error"]);
const HIDDEN_BY_DEFAULT = new Set(["content", "rawHtml", "raw_html"]);
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|#|$)/i;
const IMAGE_KEY_RE = /image|photo|thumbnail|avatar|icon|logo|cover|banner|poster|picture|img_url|photo_url|src/i;

function isUrl(val: unknown): val is string {
  return typeof val === "string" && /^https?:\/\//i.test(val);
}

function isImageUrl(val: string, colName?: string): boolean {
  if (IMAGE_EXT_RE.test(val)) return true;
  if (colName && IMAGE_KEY_RE.test(colName)) return true;
  return false;
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}>
        <img
          src={src}
          alt=""
          style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "var(--radius-lg)", objectFit: "contain" }}
        />
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: "-12px", right: "-12px", width: "28px", height: "28px",
            borderRadius: "50%", border: "1px solid var(--color-border)", background: "var(--color-surface-raised)",
            color: "var(--color-text)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "14px", fontWeight: "bold"
          }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}

function CellValue({ value, colName }: { value: unknown; colName?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  if (value === null || value === undefined || value === "") {
    return <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>&mdash;</span>;
  }

  if (typeof value === "number") {
    return <span style={{ fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString()}</span>;
  }

  // Array of image objects [{src: "..."}, ...]
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>&mdash;</span>;

    // Check if it's an array of image-like objects
    const imageItems = value.filter((item: any) =>
      typeof item === "object" && item !== null && (item.src || item.url || item.image) &&
      isUrl(item.src || item.url || item.image)
    );

    if (imageItems.length > 0) {
      return (
        <span className="flex items-center gap-1">
          {imageItems.slice(0, 3).map((item: any, idx: number) => {
            const imgUrl = item.src || item.url || item.image;
            const proxyUrl = api.images.proxyUrl(imgUrl);
            return (
              <img
                key={idx}
                src={proxyUrl}
                alt=""
                className="img-thumb"
                onClick={e => { e.stopPropagation(); setLightbox(proxyUrl); }}
                onError={e => (e.currentTarget.style.display = "none")}
                loading="lazy"
              />
            );
          })}
          {imageItems.length > 3 && (
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>+{imageItems.length - 3}</span>
          )}
          {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
        </span>
      );
    }

    const display = value.slice(0, 3).join(", ");
    return (
      <span>
        <span className="text-xs px-1.5 py-0.5 mr-1" style={{
          background: "var(--color-primary-glow)", color: "var(--color-primary)", fontSize: "0.6rem"
        }}>{value.length}</span>
        <span style={{ color: "var(--color-text-muted)" }}>{display}{value.length > 3 ? "..." : ""}</span>
      </span>
    );
  }

  if (typeof value === "object") {
    const json = JSON.stringify(value);
    const short = json.length > TRUNCATE_LEN ? json.slice(0, TRUNCATE_LEN) + "..." : json;
    return <span style={{ color: "var(--color-text-muted)", fontSize: "0.65rem", fontFamily: "monospace" }}>{short}</span>;
  }

  const str = String(value);

  if (isUrl(str)) {
    // Render as image thumbnail if it looks like an image URL
    if (isImageUrl(str, colName) && !imgError) {
      const proxyUrl = api.images.proxyUrl(str);
      return (
        <span className="flex items-center gap-1.5">
          <img
            src={proxyUrl}
            alt=""
            className="img-thumb"
            onClick={e => { e.stopPropagation(); setLightbox(proxyUrl); }}
            onError={() => setImgError(true)}
            loading="lazy"
          />
          <a
            href={str}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline"
            style={{ color: "var(--color-primary)", wordBreak: "break-all", fontSize: "0.6rem" }}
            onClick={e => e.stopPropagation()}
          >
            {str.length > 40 ? "..." + str.slice(-35) : str}
          </a>
          {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
        </span>
      );
    }

    return (
      <a
        href={str}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline"
        style={{ color: "var(--color-primary)", wordBreak: "break-all", fontSize: "0.7rem" }}
      >
        {str.length > 60 ? str.slice(0, 60) + "..." : str}
      </a>
    );
  }

  if (str.length > TRUNCATE_LEN && !expanded) {
    return (
      <span>
        {str.slice(0, TRUNCATE_LEN)}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="text-xs ml-1 cursor-pointer border-none bg-transparent"
          style={{ color: "var(--color-primary)", padding: 0 }}
        >more</button>
      </span>
    );
  }

  if (expanded) {
    return (
      <span>
        {str}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="text-xs ml-1 cursor-pointer border-none bg-transparent"
          style={{ color: "var(--color-primary)", padding: 0 }}
        >less</button>
      </span>
    );
  }

  return <span>{str}</span>;
}

type SnippetLang = "python" | "node" | "curl";

export default function DatasetViewPage() {
  const { id } = useParams();
  const datasetId = Number(id);
  const { toast } = useToast();
  const { data: dataset, isLoading, refetch } = useDataset(datasetId);
  const spawnDbMutation = useSpawnDatasetDatabase();
  const exportDbMutation = useExportDatasetDatabase();
  const deleteDbMutation = useDeleteDatasetDatabase();
  const [dbExportResult, setDbExportResult] = useState<string | null>(null);
  const [confirmDeleteDb, setConfirmDeleteDb] = useState(false);

  // Search (debounced)
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim() || undefined);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Pagination
  const [page, setPage] = useState(0);
  const limit = 50;
  const { data: rowsData, isFetching } = useDatasetRows(datasetId, limit, page * limit, search);

  // Sort
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Column visibility
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set(HIDDEN_BY_DEFAULT));
  const [showColDropdown, setShowColDropdown] = useState(false);
  const colDropdownRef = useRef<HTMLDivElement>(null);

  // Export dropdown
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Integration code
  const [showSnippet, setShowSnippet] = useState(false);
  const [snippetLang, setSnippetLang] = useState<SnippetLang>("curl");
  const { data: snippetData } = useDatasetSnippet(datasetId, snippetLang);

  // Click outside to close dropdowns
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (colDropdownRef.current && !colDropdownRef.current.contains(e.target as Node)) setShowColDropdown(false);
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExport(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const rows = rowsData?.rows || [];
  const totalFiltered = rowsData?.totalFiltered ?? dataset?.rowCount ?? 0;
  const allColumns = useMemo(() => {
    if (rows.length === 0 && dataset?.schema) return Object.keys(dataset.schema);
    if (rows.length > 0) return Object.keys(rows[0]);
    return [];
  }, [rows, dataset?.schema]);

  const visibleColumns = useMemo(
    () => allColumns.filter(c => !hiddenCols.has(c)),
    [allColumns, hiddenCols]
  );

  // Client-side sort (within current page)
  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a: any, b: any) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      const sa = String(va), sb = String(vb);
      return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [rows, sortCol, sortDir]);

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function toggleCol(col: string) {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  }

  function handleExport(format: "csv" | "json" | "jsonl") {
    window.open(api.datasets.exportUrl(datasetId, format), "_blank");
    setShowExport(false);
    toast(`Exporting as ${format.toUpperCase()}`, "success");
  }

  async function copySnippet() {
    if (!snippetData?.code) return;
    await navigator.clipboard.writeText(snippetData.code);
    toast("Copied to clipboard", "success");
  }

  if (isLoading) return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="skeleton" style={{ width: "50%", height: "1.5rem" }} />
      <div className="skeleton" style={{ width: "100%", height: "300px" }} />
    </div>
  );
  if (!dataset) return <p style={{ color: "var(--color-error)" }}>Dataset not found</p>;

  const pageStart = page * limit + 1;
  const pageEnd = Math.min(page * limit + rows.length, totalFiltered);
  const totalPages = Math.ceil(totalFiltered / limit);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Link to="/datasets" className="text-sm no-underline flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </Link>
        <span className="text-base font-semibold" style={{ letterSpacing: "-0.01em" }}>{dataset.name}</span>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{dataset.rowCount} rows</span>
      </div>

      {dataset.description && (
        <p className="text-sm mb-2" style={{ color: "var(--color-text-muted)" }}>{dataset.description}</p>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap" style={{ rowGap: "0.5rem" }}>
        {/* Search */}
        <div className="relative" style={{ flex: "1 1 200px", maxWidth: "320px", minWidth: "150px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-muted)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="input-field"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search rows..."
            style={{ paddingLeft: "2rem", fontSize: "0.75rem", width: "100%" }}
          />
          {isFetching && search && (
            <div style={{ position: "absolute", right: "0.5rem", top: "50%", transform: "translateY(-50%)" }}>
              <div className="spinner" style={{ width: 14, height: 14 }} />
            </div>
          )}
        </div>

        {/* Column visibility */}
        <div ref={colDropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowColDropdown(!showColDropdown)}
            className="btn-ghost flex items-center gap-1"
            style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 3v18M3 12h18" />
            </svg>
            Columns
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {visibleColumns.length}/{allColumns.length}
            </span>
          </button>
          {showColDropdown && (
            <div className="glass-card" style={{
              position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: "0.25rem",
              padding: "0.5rem", minWidth: "180px", maxHeight: "300px", overflowY: "auto"
            }}>
              <div className="flex items-center justify-between mb-1" style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.35rem" }}>
                <span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Toggle columns</span>
                <button
                  className="text-xs border-none bg-transparent cursor-pointer"
                  style={{ color: "var(--color-primary)" }}
                  onClick={() => setHiddenCols(new Set())}
                >Show all</button>
              </div>
              {allColumns.map(col => (
                <label key={col} className="flex items-center gap-2 cursor-pointer py-0.5" style={{ fontSize: "0.7rem" }}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(col)}
                    onChange={() => toggleCol(col)}
                    style={{ accentColor: "var(--color-primary)", width: 13, height: 13 }}
                  />
                  <span style={{ color: hiddenCols.has(col) ? "var(--color-text-muted)" : "var(--color-text)" }}>{col}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Export */}
        <div ref={exportRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowExport(!showExport)}
            className="btn-ghost flex items-center gap-1"
            style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
          {showExport && (
            <div className="glass-card" style={{
              position: "absolute", top: "100%", right: 0, zIndex: 50, marginTop: "0.25rem",
              padding: "0.25rem", minWidth: "140px"
            }}>
              {(["csv", "json", "jsonl"] as const).map(fmt => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  className="text-xs w-full text-left border-none bg-transparent cursor-pointer px-3 py-1.5"
                  style={{ color: "var(--color-text)", display: "block" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-glass)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {fmt.toUpperCase()}
                  <span className="ml-2" style={{ color: "var(--color-text-muted)" }}>
                    {fmt === "csv" ? "Spreadsheets" : fmt === "json" ? "Structured" : "LLM-ready"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Integration code toggle */}
        <button
          onClick={() => setShowSnippet(!showSnippet)}
          className={showSnippet ? "btn-primary" : "btn-ghost"}
          style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: "0.25rem", verticalAlign: "middle" }}>
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          API
        </button>
      </div>

      {/* Integration code panel */}
      {showSnippet && (
        <div className="glass-card mb-3" style={{ padding: "0.75rem" }}>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Integration Code</span>
            <div className="flex gap-1">
              {(["curl", "python", "node"] as const).map(lang => (
                <button
                  key={lang}
                  onClick={() => setSnippetLang(lang)}
                  className="text-xs px-2 py-0.5 cursor-pointer border-none font-medium"
                  style={{
                    background: snippetLang === lang ? "var(--color-primary-glow-strong)" : "var(--color-surface)",
                    color: snippetLang === lang ? "var(--color-primary)" : "var(--color-text-muted)",
                    border: `1px solid ${snippetLang === lang ? "rgba(6, 182, 212, 0.3)" : "var(--color-border)"}`,
                    transition: "all 0.15s ease"
                  }}
                >
                  {lang === "node" ? "Node.js" : lang.charAt(0).toUpperCase() + lang.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={copySnippet}
              className="btn-ghost ml-auto"
              style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem" }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginRight: "0.25rem" }}>
                <rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              Copy
            </button>
          </div>
          <SyntaxBlock
            code={snippetData?.code || "Loading..."}
            language={snippetLang === "curl" ? "bash" : snippetLang === "node" ? "javascript" : "python"}
            maxHeight="250px"
          />
        </div>
      )}

      {/* Database panel */}
      {dataset.databaseStatus && dataset.databaseStatus !== "none" ? (
        <div className="glass-card p-4 mb-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs mb-1 flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
                </svg>
                Dataset Database
                <span className="text-xs px-1.5 py-0.5 ml-1" style={{
                  background: dataset.databaseStatus === "running" ? "rgba(34, 197, 94, 0.15)" : "var(--color-surface-glass)",
                  color: dataset.databaseStatus === "running" ? "rgb(34, 197, 94)" : "var(--color-text-muted)",
                  fontSize: "0.6rem"
                }}>
                  {dataset.databaseStatus}
                </span>
              </div>
              {dataset.databaseInfo?.port && (
                <div className="text-sm font-mono font-bold">
                  Port {dataset.databaseInfo.port}
                </div>
              )}
              {dataset.databaseInfo?.connectionUrl && (
                <button
                  onClick={() => { navigator.clipboard.writeText(dataset.databaseInfo.connectionUrl); toast("Connection URL copied", "info"); }}
                  className="text-xs border-none cursor-pointer mt-1 px-0"
                  style={{ background: "transparent", color: "var(--color-primary)" }}
                >
                  Copy connection URL
                </button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                className="btn-ghost"
                disabled={exportDbMutation.isPending}
                onClick={async () => {
                  try {
                    const result = await exportDbMutation.mutateAsync(datasetId);
                    setDbExportResult(`Exported to ${result.dir} (${result.sizeHuman})`);
                    toast("Database exported", "success");
                  } catch (err: any) {
                    toast(`Export failed: ${err.message}`, "error");
                  }
                }}
              >
                {exportDbMutation.isPending ? "Exporting..." : "Export"}
              </button>
              <button className="btn-danger" onClick={() => setConfirmDeleteDb(true)}>
                Delete DB
              </button>
            </div>
          </div>
          {dbExportResult && (
            <div className="text-xs mt-3 p-2.5" style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}>
              {dbExportResult}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <button
            className="btn-ghost"
            disabled={spawnDbMutation.isPending}
            onClick={async () => {
              try {
                await spawnDbMutation.mutateAsync(datasetId);
                toast("Database created", "success");
                refetch();
              } catch (err: any) {
                toast(`Failed to create database: ${err.message}`, "error");
              }
            }}
            style={{ padding: "0.35rem 0.6rem", fontSize: "0.7rem" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: "0.25rem" }}>
              <rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" />
            </svg>
            {spawnDbMutation.isPending ? "Creating..." : "Create Database"}
          </button>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Spin up a Docker Postgres container with typed columns for this dataset
          </span>
        </div>
      )}

      {/* Delete DB confirmation modal */}
      <ConfirmModal
        open={confirmDeleteDb}
        title="Delete Dataset Database"
        confirmLabel="Delete Permanently"
        confirmColor="var(--color-error)"
        onConfirm={async () => {
          try {
            await deleteDbMutation.mutateAsync(datasetId);
            toast("Database deleted", "success");
            setConfirmDeleteDb(false);
            refetch();
          } catch (err: any) {
            toast(`Delete failed: ${err.message}`, "error");
          }
        }}
        onCancel={() => setConfirmDeleteDb(false)}
        loading={deleteDbMutation.isPending}
      >
        <p className="m-0 mb-2">
          This will <strong>permanently destroy</strong> the Docker database container for this dataset.
        </p>
        <p className="m-0" style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
          Your dataset data in the main database is not affected. You can re-create the database later.
        </p>
      </ConfirmModal>

      {/* Data table */}
      {rows.length > 0 ? (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table" style={{ fontSize: "0.7rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "40px", textAlign: "center", color: "var(--color-text-muted)", fontSize: "0.6rem" }}>#</th>
                  {visibleColumns.map(col => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      style={{
                        cursor: "pointer",
                        userSelect: "none",
                        maxWidth: WIDE_COLUMNS.has(col) ? "300px" : "180px",
                        whiteSpace: "nowrap"
                      }}
                    >
                      <span className="flex items-center gap-1">
                        {col}
                        {sortCol === col && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            {sortDir === "asc"
                              ? <polyline points="18 15 12 9 6 15" />
                              : <polyline points="6 9 12 15 18 9" />}
                          </svg>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row: any, i: number) => (
                  <tr key={i}>
                    <td style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "0.6rem", opacity: 0.6 }}>
                      {page * limit + i + 1}
                    </td>
                    {visibleColumns.map(col => (
                      <td key={col} style={{
                        maxWidth: WIDE_COLUMNS.has(col) ? "300px" : "180px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        textAlign: typeof row[col] === "number" ? "right" : "left"
                      }}>
                        <CellValue value={row[col]} colName={col} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {search ? `No rows matching "${search}"` : "No rows in this dataset"}
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalFiltered > 0 && (
        <div className="flex items-center gap-2 mt-2 flex-wrap" style={{ justifyContent: "space-between" }}>
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Showing {pageStart}&ndash;{pageEnd} of {totalFiltered} rows
            {search && ` (filtered)`}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="btn-ghost"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem", opacity: page === 0 ? 0.4 : 1 }}
              >
                Previous
              </button>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {page + 1} / {totalPages}
              </span>
              <button
                disabled={page + 1 >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="btn-ghost"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.7rem", opacity: page + 1 >= totalPages ? 0.4 : 1 }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
