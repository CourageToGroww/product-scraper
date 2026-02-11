import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExtractPreview, useExtractSingleToDataset } from "../lib/hooks";
import { useToast } from "./Toast";
import SyntaxBlock from "./SyntaxBlock";

const CATEGORIES = [
  "headings", "links", "images", "tables", "metadata",
  "emails", "phones", "videos"
] as const;

const CSS_DEFAULT = `{
  "title": "h1",
  "links": "a @href",
  "paragraphs": "p"
}`;

const LIST_DEFAULT = `{
  "wrapper": "a[href*='/products/']",
  "fields": {
    "name": "",
    "link": "@href",
    "image": "img @src"
  }
}`;

type Mode = "css" | "autoparse" | "convert" | "list";

export default function ResultRowExtractor({
  jobId,
  resultId,
  url
}: {
  jobId: number;
  resultId: number;
  url: string;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const previewMutation = useExtractPreview();
  const saveMutation = useExtractSingleToDataset();

  const [mode, setMode] = useState<Mode>("list");
  const [preview, setPreview] = useState<any>(null);

  // CSS state
  const [cssSchema, setCssSchema] = useState(CSS_DEFAULT);

  // AutoParse state
  const [categories, setCategories] = useState<Set<string>>(
    new Set(["headings", "links", "images", "metadata"])
  );

  // Convert state
  const [convertFormat, setConvertFormat] = useState<"markdown" | "plaintext">("markdown");

  // List state
  const [listConfig, setListConfig] = useState(LIST_DEFAULT);

  // Save state
  const [showSave, setShowSave] = useState(false);
  const [datasetName, setDatasetName] = useState("");

  function getConfig(): Record<string, unknown> | null {
    switch (mode) {
      case "css": {
        try {
          return { selectors: JSON.parse(cssSchema) };
        } catch {
          toast("Invalid JSON in CSS selectors", "error");
          return null;
        }
      }
      case "autoparse":
        return { categories: Array.from(categories) };
      case "convert":
        return { format: convertFormat };
      case "list": {
        try {
          const parsed = JSON.parse(listConfig);
          if (!parsed.wrapper || !parsed.fields) {
            toast("List config needs 'wrapper' and 'fields'", "error");
            return null;
          }
          return parsed;
        } catch {
          toast("Invalid JSON in list config", "error");
          return null;
        }
      }
    }
  }

  async function handleExtract() {
    const config = getConfig();
    if (!config) return;

    try {
      const result = await previewMutation.mutateAsync({
        jobId,
        resultId,
        mode,
        config
      });
      setPreview(result);
    } catch (err: any) {
      toast(err.message, "error");
      setPreview(null);
    }
  }

  async function handleSave() {
    const name = datasetName.trim();
    if (!name) {
      toast("Enter a dataset name", "error");
      return;
    }
    const config = getConfig();
    if (!config) return;

    try {
      const result = await saveMutation.mutateAsync({
        jobId,
        resultId,
        mode,
        config,
        datasetName: name
      });
      toast("Dataset created", "success");
      navigate(`/datasets/${result.datasetId}`);
    } catch (err: any) {
      toast(err.message, "error");
    }
  }

  function toggleCategory(cat: string) {
    setCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  const modes: { key: Mode; label: string }[] = [
    { key: "list", label: "List" },
    { key: "autoparse", label: "Auto-Parse" },
    { key: "css", label: "CSS" },
    { key: "convert", label: "Convert" }
  ];

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
      {/* Mode chips */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Extract:</span>
        {modes.map(m => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setPreview(null); }}
            className="text-xs px-2.5 py-1 cursor-pointer border-none font-medium"
            style={{
              background: mode === m.key ? "var(--color-primary-glow-strong)" : "var(--color-surface-glass)",
              color: mode === m.key ? "var(--color-primary)" : "var(--color-text-muted)",
              border: `1px solid ${mode === m.key ? "rgba(6, 182, 212, 0.3)" : "var(--color-border)"}`,
              transition: "all 0.15s ease"
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mode config */}
      {mode === "css" && (
        <textarea
          className="input-field font-mono mb-2"
          value={cssSchema}
          onChange={e => setCssSchema(e.target.value)}
          rows={4}
          style={{ resize: "vertical", fontSize: "0.7rem", lineHeight: "1.5", width: "100%" }}
        />
      )}

      {mode === "autoparse" && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className="text-xs px-2 py-1 cursor-pointer border-none capitalize"
              style={{
                background: categories.has(cat) ? "var(--color-primary-glow-strong)" : "var(--color-surface)",
                color: categories.has(cat) ? "var(--color-primary)" : "var(--color-text-muted)",
                border: `1px solid ${categories.has(cat) ? "rgba(6, 182, 212, 0.3)" : "var(--color-border)"}`,
                fontSize: "0.65rem"
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {mode === "list" && (
        <div className="mb-2">
          <textarea
            className="input-field font-mono mb-1"
            value={listConfig}
            onChange={e => setListConfig(e.target.value)}
            rows={6}
            style={{ resize: "vertical", fontSize: "0.65rem", lineHeight: "1.4", width: "100%" }}
          />
          <div className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "0.6rem" }}>
            <strong>wrapper</strong>: repeating element selector. <strong>fields</strong>: {`"" = text, @attr = attribute, "sub @attr" = child attr`}
          </div>
        </div>
      )}

      {mode === "convert" && (
        <div className="flex gap-2 mb-2">
          {(["markdown", "plaintext"] as const).map(fmt => (
            <label
              key={fmt}
              className="flex items-center gap-1.5 text-xs cursor-pointer px-2 py-1"
              style={{
                background: convertFormat === fmt ? "var(--color-primary-glow)" : "transparent",
                border: `1px solid ${convertFormat === fmt ? "rgba(6, 182, 212, 0.3)" : "var(--color-border)"}`,
                color: convertFormat === fmt ? "var(--color-primary)" : "var(--color-text-muted)"
              }}
            >
              <input
                type="radio"
                name={`format-${resultId}`}
                value={fmt}
                checked={convertFormat === fmt}
                onChange={() => setConvertFormat(fmt)}
                style={{ accentColor: "var(--color-primary)", width: 12, height: 12 }}
              />
              <span className="capitalize">{fmt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleExtract}
          disabled={previewMutation.isPending}
          className="btn-primary"
          style={{ padding: "0.3rem 0.75rem", fontSize: "0.7rem" }}
        >
          {previewMutation.isPending ? "Extracting..." : "Extract"}
        </button>
        {preview && (
          <button
            onClick={() => setShowSave(!showSave)}
            className="btn-ghost"
            style={{ padding: "0.3rem 0.75rem", fontSize: "0.7rem" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <path d="M17 21v-8H7v8M7 3v5h8" />
            </svg>
            Save as Dataset
          </button>
        )}
      </div>

      {/* Save form */}
      {showSave && (
        <div className="flex items-end gap-2 mt-2 flex-wrap">
          <input
            className="input-field"
            value={datasetName}
            onChange={e => setDatasetName(e.target.value)}
            placeholder="Dataset name"
            style={{ flex: 1, minWidth: "150px", fontSize: "0.75rem" }}
          />
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="btn-primary"
            style={{ padding: "0.3rem 0.75rem", fontSize: "0.7rem" }}
          >
            {saveMutation.isPending ? "Saving..." : "Create"}
          </button>
          <button
            onClick={() => setShowSave(false)}
            className="btn-ghost"
            style={{ padding: "0.3rem 0.75rem", fontSize: "0.7rem" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Preview result */}
      {preview && Array.isArray(preview.data) && (
        <div className="text-xs mt-2 mb-1" style={{ color: "var(--color-primary)" }}>
          {preview.data.length} items found &mdash; Save as Dataset to create {preview.data.length} rows
        </div>
      )}
      {preview && (
        <div style={{ marginTop: "0.5rem" }}>
          <SyntaxBlock
            code={typeof preview.data === "string" ? preview.data : JSON.stringify(preview.data, null, 2)}
            language={typeof preview.data === "string" ? "markdown" : "json"}
            maxHeight="250px"
          />
        </div>
      )}
    </div>
  );
}
