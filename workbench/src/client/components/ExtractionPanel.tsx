import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExtractPreview, useExtractToDataset, useAutoDetect } from "../lib/hooks";
import { useToast } from "./Toast";
import SyntaxBlock from "./SyntaxBlock";
import ExtractionConfigEditor, {
  type ExtractionMode,
  CSS_PLACEHOLDER,
  LIST_PLACEHOLDER,
  getExtractionConfig,
  applySuggestedConfig
} from "./ExtractionConfigEditor";

export default function ExtractionPanel({
  jobId,
  hasRawHtml
}: {
  jobId: number;
  hasRawHtml: boolean;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const previewMutation = useExtractPreview();
  const toDatasetMutation = useExtractToDataset();
  const autoDetectMutation = useAutoDetect();

  const [mode, setMode] = useState<ExtractionMode>("list");
  const [preview, setPreview] = useState<any>(null);
  const [detection, setDetection] = useState<{ type: string; confidence: number } | null>(null);

  // Config state
  const [cssSchema, setCssSchema] = useState(CSS_PLACEHOLDER);
  const [categories, setCategories] = useState<Set<string>>(new Set(["headings", "links", "images"]));
  const [convertFormat, setConvertFormat] = useState<"markdown" | "plaintext">("markdown");
  const [listConfig, setListConfig] = useState(LIST_PLACEHOLDER);

  // Dataset name
  const [datasetName, setDatasetName] = useState("");
  const [showSave, setShowSave] = useState(false);

  if (!hasRawHtml) {
    return (
      <div className="glass-card p-4 mb-2" style={{ borderLeft: "3px solid var(--color-warning)" }}>
        <div className="text-sm font-semibold" style={{ color: "var(--color-warning)" }}>
          Raw HTML not available
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          This scrape was created before extraction support was added. Re-scrape the URLs to capture raw HTML for extraction.
        </div>
      </div>
    );
  }

  function getCurrentConfig() {
    return getExtractionConfig(
      { mode, cssSchema, categories, convertFormat, listConfig },
      (msg) => toast(msg, "error")
    );
  }

  async function handlePreview() {
    const config = getCurrentConfig();
    if (!config) return;

    try {
      const result = await previewMutation.mutateAsync({ jobId, mode, config });
      setPreview(result);
    } catch (err: any) {
      toast(err.message, "error");
      setPreview(null);
    }
  }

  async function handleSaveAsDataset() {
    if (!datasetName.trim()) {
      toast("Enter a dataset name", "error");
      return;
    }
    const config = getCurrentConfig();
    if (!config) return;

    try {
      const result = await toDatasetMutation.mutateAsync({
        jobId, mode, config,
        datasetName: datasetName.trim()
      });
      toast(`Dataset created with ${result.rowCount} rows`, "success");
      navigate(`/datasets/${result.datasetId}`);
    } catch (err: any) {
      toast(err.message, "error");
    }
  }

  return (
    <div className="glass-card overflow-hidden mb-2">
      <ExtractionConfigEditor
        mode={mode}
        onModeChange={(m) => { setMode(m); setPreview(null); }}
        cssSchema={cssSchema}
        onCssSchemaChange={setCssSchema}
        categories={categories}
        onCategoriesChange={setCategories}
        convertFormat={convertFormat}
        onConvertFormatChange={setConvertFormat}
        listConfig={listConfig}
        onListConfigChange={setListConfig}
      />

      <div className="px-4 pb-4">
        {/* Auto-detect + action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => {
              try {
                const result = await autoDetectMutation.mutateAsync({ jobId });
                setDetection({ type: result.type, confidence: result.confidence });
                if (result.suggestedConfig) {
                  applySuggestedConfig(
                    result.suggestedConfig,
                    setMode, setCssSchema, setCategories, setConvertFormat, setListConfig
                  );
                  toast(`Detected: ${result.type} (${Math.round(result.confidence * 100)}% confidence)`, "success");
                } else {
                  toast(`Detected: ${result.type} — no config suggestion available`, "info");
                }
              } catch (err: any) {
                toast(`Auto-detect failed: ${err.message}`, "error");
              }
            }}
            disabled={autoDetectMutation.isPending}
            className="btn-ghost"
          >
            {autoDetectMutation.isPending ? "Detecting..." : "Auto-Detect"}
          </button>
          {detection && (
            <span className="text-xs px-2 py-0.5" style={{
              background: "var(--color-primary-glow-strong)",
              color: "var(--color-primary)"
            }}>
              {detection.type} ({Math.round(detection.confidence * 100)}%)
            </span>
          )}
          <button
            onClick={handlePreview}
            disabled={previewMutation.isPending}
            className="btn-ghost"
          >
            {previewMutation.isPending ? "Extracting..." : "Preview First Result"}
          </button>
          <button
            onClick={() => setShowSave(!showSave)}
            className="btn-primary"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </svg>
            Save as Dataset
          </button>
        </div>

        {/* Save form */}
        {showSave && (
          <div className="flex items-end gap-2 mt-3 flex-wrap">
            <div style={{ flex: 1, minWidth: "200px" }}>
              <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Dataset Name</label>
              <input
                className="input-field"
                value={datasetName}
                onChange={e => setDatasetName(e.target.value)}
                placeholder="My extracted data"
              />
            </div>
            <button
              onClick={handleSaveAsDataset}
              disabled={toDatasetMutation.isPending}
              className="btn-primary"
            >
              {toDatasetMutation.isPending ? "Saving..." : "Create Dataset"}
            </button>
            <button onClick={() => setShowSave(false)} className="btn-ghost">Cancel</button>
          </div>
        )}

        {/* Preview result */}
        {preview && (
          <div className="mt-4" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1rem" }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Preview</div>
              <div className="text-xs truncate" style={{ color: "var(--color-primary)", maxWidth: "400px" }}>{preview.url}</div>
              {Array.isArray(preview.data) && (
                <span className="text-xs px-2 py-0.5" style={{
                  background: "var(--color-primary-glow-strong)", color: "var(--color-primary)"
                }}>{preview.data.length} items</span>
              )}
            </div>
            <SyntaxBlock
              code={typeof preview.data === "string" ? preview.data : JSON.stringify(preview.data, null, 2)}
              language={typeof preview.data === "string" ? "markdown" : "json"}
              maxHeight="300px"
            />
          </div>
        )}
      </div>
    </div>
  );
}
