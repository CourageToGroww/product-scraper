import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAutoparseCategoryToDataset } from "../lib/hooks";
import { useToast } from "./Toast";
import SyntaxBlock from "./SyntaxBlock";
import ResultRowExtractor from "./ResultRowExtractor";
import * as api from "../lib/api";

type Tab = "overview" | "links" | "images" | "tables" | "content" | "extract" | "raw";

interface ResultData {
  id: number;
  url: string;
  status?: number;
  timing?: number;
  error?: string;
  rawHtml?: string;
  convertedContent?: string;
  responseType?: string;
  screenshotBase64?: string;
  extractedData?: any;
  autoparseData?: any;
  networkRequests?: any[];
}

function countItems(data: any, key: string): number {
  if (!data?.[key]) return 0;
  if (Array.isArray(data[key])) return data[key].length;
  if (key === "headings" && typeof data[key] === "object") {
    return Object.values(data[key]).reduce((sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  }
  if (key === "metadata" && typeof data[key] === "object") return 1;
  return 0;
}

function QuickSaveButton({
  label,
  count,
  jobId,
  resultId,
  category,
  tableIndex,
}: {
  label: string;
  count: number;
  jobId: number;
  resultId: number;
  category: string;
  tableIndex?: number;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const saveMutation = useAutoparseCategoryToDataset();
  const [showInput, setShowInput] = useState(false);
  const [dsName, setDsName] = useState("");

  if (count === 0) return null;

  const handleSave = async () => {
    const name = dsName.trim();
    if (!name) { toast("Enter a dataset name", "error"); return; }
    try {
      const result = await saveMutation.mutateAsync({
        jobId, resultId, category,
        ...(tableIndex != null ? { tableIndex } : {}),
        datasetName: name
      });
      toast(`Dataset created with ${result.rowCount} rows`, "success");
      navigate(`/datasets/${result.datasetId}`);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!showInput ? (
        <button
          onClick={() => { setShowInput(true); setDsName(`${label} export`); }}
          className="btn-ghost"
          style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
          {count} {label} &rarr; Dataset
        </button>
      ) : (
        <>
          <input
            className="input-field"
            value={dsName}
            onChange={e => setDsName(e.target.value)}
            placeholder="Dataset name"
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem", minWidth: "120px", flex: 1, maxWidth: "200px" }}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="btn-primary"
            style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem" }}
          >
            {saveMutation.isPending ? "..." : "Create"}
          </button>
          <button onClick={() => setShowInput(false)} className="btn-ghost" style={{ padding: "0.2rem 0.5rem", fontSize: "0.65rem" }}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

export default function StructuredResultViewer({
  result,
  jobId,
  onLightbox
}: {
  result: ResultData;
  jobId: number;
  onLightbox?: (src: string) => void;
}) {
  const auto = result.autoparseData || {};
  const hasLinks = countItems(auto, "links") > 0;
  const hasImages = countItems(auto, "images") > 0;
  const hasTables = countItems(auto, "tables") > 0;
  const hasContent = !!result.convertedContent || !!result.screenshotBase64;
  const hasRawHtml = !!result.rawHtml && !!result.id;

  // Determine initial tab
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "overview", label: "Overview", show: true },
    { key: "links", label: `Links (${countItems(auto, "links")})`, show: hasLinks },
    { key: "images", label: `Images (${countItems(auto, "images")})`, show: hasImages },
    { key: "tables", label: `Tables (${countItems(auto, "tables")})`, show: hasTables },
    { key: "content", label: "Content", show: hasContent },
    { key: "extract", label: "Extract", show: hasRawHtml },
    { key: "raw", label: "Raw", show: true }
  ];

  return (
    <div className="grid gap-2">
      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-wrap" style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: "0.5rem" }}>
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="text-xs px-2.5 py-1 cursor-pointer border-none font-medium"
            style={{
              background: tab === t.key ? "var(--color-primary-glow-strong)" : "transparent",
              color: tab === t.key ? "var(--color-primary)" : "var(--color-text-muted)",
              borderBottom: tab === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
              transition: "all 0.15s ease"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === "overview" && (
        <div className="grid gap-3">
          {/* Metadata summary */}
          {auto.metadata && (
            <div>
              {auto.metadata.title && (
                <div className="text-sm font-semibold mb-1" style={{ color: "var(--color-text)" }}>
                  {auto.metadata.title}
                </div>
              )}
              {auto.metadata.description && (
                <div className="text-xs mb-2" style={{ color: "var(--color-text-muted)", lineHeight: "1.5" }}>
                  {auto.metadata.description}
                </div>
              )}
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 flex-wrap">
            {hasLinks && <StatChip label="Links" count={countItems(auto, "links")} />}
            {hasImages && <StatChip label="Images" count={countItems(auto, "images")} />}
            {hasTables && <StatChip label="Tables" count={countItems(auto, "tables")} />}
            {countItems(auto, "headings") > 0 && <StatChip label="Headings" count={countItems(auto, "headings")} />}
            {countItems(auto, "emails") > 0 && <StatChip label="Emails" count={countItems(auto, "emails")} />}
            {countItems(auto, "phones") > 0 && <StatChip label="Phones" count={countItems(auto, "phones")} />}
            {countItems(auto, "videos") > 0 && <StatChip label="Videos" count={countItems(auto, "videos")} />}
            {countItems(auto, "audios") > 0 && <StatChip label="Audios" count={countItems(auto, "audios")} />}
            {countItems(auto, "menus") > 0 && <StatChip label="Menus" count={countItems(auto, "menus")} />}
            {countItems(auto, "hashtags") > 0 && <StatChip label="Hashtags" count={countItems(auto, "hashtags")} />}
            {countItems(auto, "favicons") > 0 && <StatChip label="Favicons" count={countItems(auto, "favicons")} />}
            {result.timing && <StatChip label="Time" count={result.timing} suffix="ms" />}
            {result.networkRequests?.length ? <StatChip label="XHR" count={result.networkRequests.length} /> : null}
          </div>

          {/* Quick-create buttons */}
          <div className="grid gap-1.5">
            <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Quick Create Dataset</div>
            <div className="flex items-center gap-2 flex-wrap">
              <QuickSaveButton label="Links" count={countItems(auto, "links")} jobId={jobId} resultId={result.id} category="links" />
              <QuickSaveButton label="Images" count={countItems(auto, "images")} jobId={jobId} resultId={result.id} category="images" />
              <QuickSaveButton label="Emails" count={countItems(auto, "emails")} jobId={jobId} resultId={result.id} category="emails" />
              <QuickSaveButton label="Phones" count={countItems(auto, "phones")} jobId={jobId} resultId={result.id} category="phones" />
              <QuickSaveButton label="Headings" count={countItems(auto, "headings")} jobId={jobId} resultId={result.id} category="headings" />
              <QuickSaveButton label="Videos" count={countItems(auto, "videos")} jobId={jobId} resultId={result.id} category="videos" />
              <QuickSaveButton label="Audios" count={countItems(auto, "audios")} jobId={jobId} resultId={result.id} category="audios" />
              <QuickSaveButton label="Menus" count={countItems(auto, "menus")} jobId={jobId} resultId={result.id} category="menus" />
              <QuickSaveButton label="Hashtags" count={countItems(auto, "hashtags")} jobId={jobId} resultId={result.id} category="hashtags" />
              <QuickSaveButton label="Favicons" count={countItems(auto, "favicons")} jobId={jobId} resultId={result.id} category="favicons" />
              <QuickSaveButton label="Metadata" count={countItems(auto, "metadata")} jobId={jobId} resultId={result.id} category="metadata" />
              {auto.tables?.map((_: any, idx: number) => (
                <QuickSaveButton key={idx} label={`Table ${idx}`} count={auto.tables[idx]?.rows?.length || 0} jobId={jobId} resultId={result.id} category="tables" tableIndex={idx} />
              ))}
            </div>
          </div>

          {/* Error */}
          {result.error && (
            <div className="text-xs" style={{ color: "var(--color-error)" }}>
              Error: {result.error}
            </div>
          )}
        </div>
      )}

      {/* === LINKS TAB === */}
      {tab === "links" && auto.links && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>{auto.links.length} links found</div>
            <QuickSaveButton label="Links" count={auto.links.length} jobId={jobId} resultId={result.id} category="links" />
          </div>
          <div style={{ maxHeight: "400px", overflow: "auto" }}>
            <table className="data-table" style={{ fontSize: "0.7rem" }}>
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>Text</th>
                  <th>URL</th>
                  <th style={{ width: "50px" }}>Rel</th>
                </tr>
              </thead>
              <tbody>
                {auto.links.map((link: any, i: number) => (
                  <tr key={i}>
                    <td className="truncate" style={{ maxWidth: "200px" }}>{link.text || "-"}</td>
                    <td className="truncate font-mono" style={{ maxWidth: "300px", fontSize: "0.6rem" }}>
                      <a href={link.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)" }}>
                        {link.href}
                      </a>
                    </td>
                    <td style={{ color: "var(--color-text-muted)" }}>{link.rel || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* === IMAGES TAB === */}
      {tab === "images" && auto.images && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>{auto.images.length} images found</div>
            <QuickSaveButton label="Images" count={auto.images.length} jobId={jobId} resultId={result.id} category="images" />
          </div>
          <div className="flex flex-wrap gap-2">
            {auto.images.map((img: any, idx: number) => {
              const imgUrl = typeof img === "string" ? img : img.src;
              if (!imgUrl || !/^https?:\/\//i.test(imgUrl)) return null;
              const proxyUrl = api.images.proxyUrl(imgUrl);
              return (
                <div key={idx} className="grid gap-1" style={{ width: "120px" }}>
                  <img
                    src={proxyUrl}
                    alt={img.alt || ""}
                    className="img-thumb-lg"
                    style={{ width: "120px", height: "90px", objectFit: "cover", cursor: "pointer" }}
                    onClick={() => onLightbox?.(proxyUrl)}
                    onError={e => (e.currentTarget.style.display = "none")}
                    loading="lazy"
                  />
                  {img.alt && (
                    <div className="text-xs truncate" style={{ color: "var(--color-text-muted)", fontSize: "0.55rem", maxWidth: "120px" }}>
                      {img.alt}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* === TABLES TAB === */}
      {tab === "tables" && auto.tables && (
        <div className="grid gap-3">
          {auto.tables.map((table: any, tIdx: number) => (
            <div key={tIdx}>
              <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
                  Table {tIdx}: {table.headers?.join(", ") || "no headers"} ({table.rows?.length || 0} rows)
                </div>
                <QuickSaveButton label={`Table ${tIdx}`} count={table.rows?.length || 0} jobId={jobId} resultId={result.id} category="tables" tableIndex={tIdx} />
              </div>
              <div style={{ maxHeight: "300px", overflow: "auto" }}>
                <table className="data-table" style={{ fontSize: "0.65rem" }}>
                  {table.headers?.length > 0 && (
                    <thead>
                      <tr>
                        {table.headers.map((h: string, i: number) => <th key={i}>{h}</th>)}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {(table.rows || []).slice(0, 50).map((row: any[], rIdx: number) => (
                      <tr key={rIdx}>
                        {row.map((cell: any, cIdx: number) => (
                          <td key={cIdx} className="truncate" style={{ maxWidth: "200px" }}>{cell ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(table.rows?.length || 0) > 50 && (
                  <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                    Showing 50 of {table.rows.length} rows
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* === CONTENT TAB === */}
      {tab === "content" && (
        <div className="grid gap-3">
          {result.screenshotBase64 && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Screenshot</div>
              <img
                src={result.screenshotBase64}
                alt="Page screenshot"
                style={{ maxWidth: "100%", maxHeight: "400px", borderRadius: "var(--radius)", border: "1px solid var(--color-border)", cursor: "pointer" }}
                onClick={() => onLightbox?.(result.screenshotBase64!)}
              />
            </div>
          )}
          {result.convertedContent && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>
                Converted Content ({result.responseType || "markdown"})
              </div>
              <div
                className="text-xs"
                style={{
                  maxHeight: "400px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  color: "var(--color-text-muted)",
                  background: "var(--color-surface)",
                  padding: "0.75rem",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--color-border)",
                  lineHeight: "1.6",
                  fontFamily: "monospace",
                  fontSize: "0.65rem"
                }}
              >
                {result.convertedContent}
              </div>
            </div>
          )}
          {!result.screenshotBase64 && !result.convertedContent && (
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              No content data available. Enable screenshot or markdown/plaintext conversion when scraping.
            </div>
          )}
        </div>
      )}

      {/* === EXTRACT TAB === */}
      {tab === "extract" && hasRawHtml && (
        <ResultRowExtractor jobId={jobId} resultId={result.id} url={result.url} />
      )}

      {/* === RAW TAB === */}
      {tab === "raw" && (
        <div className="grid gap-3">
          {result.extractedData && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Extracted Data</div>
              <SyntaxBlock code={JSON.stringify(result.extractedData, null, 2)} maxHeight="300px" />
            </div>
          )}
          {result.autoparseData && (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Auto-Parsed Data</div>
              <SyntaxBlock code={JSON.stringify(result.autoparseData, null, 2)} maxHeight="300px" />
            </div>
          )}
          {result.networkRequests?.length ? (
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: "var(--color-text-muted)" }}>Network Requests ({result.networkRequests.length})</div>
              <SyntaxBlock code={JSON.stringify(result.networkRequests, null, 2)} maxHeight="300px" />
            </div>
          ) : null}
          {!result.extractedData && !result.autoparseData && !result.networkRequests?.length && (
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>No raw data available</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, count, suffix }: { label: string; count: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs px-2 py-1" style={{
      background: "var(--color-surface-glass)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius)"
    }}>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span className="font-bold" style={{ color: "var(--color-primary)" }}>{count}{suffix || ""}</span>
    </div>
  );
}
