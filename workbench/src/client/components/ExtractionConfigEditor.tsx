import React, { useState, useCallback, useEffect } from "react";

export const AUTOPARSE_CATEGORIES = [
  "headings", "links", "images", "tables", "metadata",
  "emails", "phones", "videos", "audios", "menus",
  "hashtags", "favicons"
] as const;

export const CSS_PLACEHOLDER = `{
  "title": "h1",
  "links": "a @href",
  "paragraphs": "p"
}`;

export const LIST_PLACEHOLDER = `{
  "wrapper": "a[href*='/products/']",
  "fields": {
    "name": "",
    "link": "@href",
    "image": "img @src"
  }
}`;

export type ExtractionMode = "css" | "autoparse" | "convert" | "list";

export interface ExtractionConfigState {
  mode: ExtractionMode;
  cssSchema: string;
  categories: Set<string>;
  convertFormat: "markdown" | "plaintext";
  listConfig: string;
}

export interface ExtractionConfigEditorProps {
  mode: ExtractionMode;
  onModeChange: (mode: ExtractionMode) => void;
  cssSchema: string;
  onCssSchemaChange: (val: string) => void;
  categories: Set<string>;
  onCategoriesChange: (cats: Set<string>) => void;
  convertFormat: "markdown" | "plaintext";
  onConvertFormatChange: (fmt: "markdown" | "plaintext") => void;
  listConfig: string;
  onListConfigChange: (val: string) => void;
  compact?: boolean;
}

/**
 * Get extraction config from the current editor state.
 * Returns null and calls onError if validation fails.
 */
export function getExtractionConfig(
  state: ExtractionConfigState,
  onError?: (msg: string) => void
): Record<string, unknown> | null {
  switch (state.mode) {
    case "css": {
      try {
        return { selectors: JSON.parse(state.cssSchema) };
      } catch {
        onError?.("Invalid JSON in CSS selectors");
        return null;
      }
    }
    case "autoparse":
      return { categories: Array.from(state.categories) };
    case "convert":
      return { format: state.convertFormat };
    case "list": {
      try {
        const parsed = JSON.parse(state.listConfig);
        if (!parsed.wrapper || !parsed.fields) {
          onError?.("List config needs 'wrapper' and 'fields'");
          return null;
        }
        return parsed;
      } catch {
        onError?.("Invalid JSON in list config");
        return null;
      }
    }
  }
}

/**
 * Apply a suggested config from auto-detect to the editor state.
 */
export function applySuggestedConfig(
  config: { mode: string; config: Record<string, unknown> },
  setMode: (m: ExtractionMode) => void,
  setCssSchema: (v: string) => void,
  setCategories: (c: Set<string>) => void,
  setConvertFormat: (f: "markdown" | "plaintext") => void,
  setListConfig: (v: string) => void
): void {
  const mode = config.mode as ExtractionMode;
  setMode(mode);
  switch (mode) {
    case "css":
      if (config.config.selectors) {
        setCssSchema(JSON.stringify(config.config.selectors, null, 2));
      }
      break;
    case "autoparse":
      if (config.config.category) {
        setCategories(new Set([config.config.category as string]));
      } else if (Array.isArray(config.config.categories)) {
        setCategories(new Set(config.config.categories as string[]));
      }
      break;
    case "convert":
      if (config.config.format === "plaintext" || config.config.format === "markdown") {
        setConvertFormat(config.config.format);
      }
      break;
    case "list":
      setListConfig(JSON.stringify(config.config, null, 2));
      break;
  }
}

const TABS: { key: ExtractionMode; label: string }[] = [
  { key: "list", label: "List Extract" },
  { key: "css", label: "CSS Selectors" },
  { key: "autoparse", label: "Auto-Parse" },
  { key: "convert", label: "Convert" }
];

export default function ExtractionConfigEditor({
  mode, onModeChange,
  cssSchema, onCssSchemaChange,
  categories, onCategoriesChange,
  convertFormat, onConvertFormatChange,
  listConfig, onListConfigChange,
  compact = false,
}: ExtractionConfigEditorProps) {
  const toggleCategory = useCallback((cat: string) => {
    const next = new Set(categories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    onCategoriesChange(next);
  }, [categories, onCategoriesChange]);

  return (
    <div>
      {/* Tab bar */}
      <div className="flex" style={{ borderBottom: "1px solid var(--color-border)" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => onModeChange(t.key)}
            className="text-xs font-semibold px-4 py-2.5 border-none cursor-pointer"
            style={{
              background: mode === t.key ? "var(--color-surface-glass)" : "transparent",
              color: mode === t.key ? "var(--color-primary)" : "var(--color-text-muted)",
              borderBottom: mode === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
              transition: "all 0.15s ease"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={compact ? "p-3" : "p-4"}>
        {/* CSS Selectors */}
        {mode === "css" && (
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
              Selector Schema (JSON)
            </label>
            <textarea
              className="input-field font-mono"
              value={cssSchema}
              onChange={e => onCssSchemaChange(e.target.value)}
              placeholder={CSS_PLACEHOLDER}
              rows={compact ? 4 : 6}
              style={{ resize: "vertical", fontSize: "0.75rem", lineHeight: "1.5" }}
            />
            <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              Use <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>@href</code>,{" "}
              <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>@src</code>,{" "}
              <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>@attr</code> for attributes.{" "}
              <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>@html</code> for inner HTML.
            </div>
          </div>
        )}

        {/* Auto-Parse */}
        {mode === "autoparse" && (
          <div>
            <label className="text-xs block mb-2" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
              Categories to extract
            </label>
            <div className="flex flex-wrap gap-2">
              {AUTOPARSE_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className="text-xs px-3 py-1.5 cursor-pointer border-none font-medium capitalize"
                  style={{
                    background: categories.has(cat) ? "var(--color-primary-glow-strong)" : "var(--color-surface-glass)",
                    color: categories.has(cat) ? "var(--color-primary)" : "var(--color-text-muted)",
                    border: `1px solid ${categories.has(cat) ? "rgba(6, 182, 212, 0.3)" : "var(--color-border)"}`,
                    transition: "all 0.15s ease"
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* List Extract */}
        {mode === "list" && (
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
              List Config (JSON)
            </label>
            <textarea
              className="input-field font-mono"
              value={listConfig}
              onChange={e => onListConfigChange(e.target.value)}
              placeholder={LIST_PLACEHOLDER}
              rows={compact ? 6 : 8}
              style={{ resize: "vertical", fontSize: "0.75rem", lineHeight: "1.5" }}
            />
            <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              <strong>wrapper</strong>: CSS selector for repeating elements (one row per match).{" "}
              <strong>fields</strong>: name{" \u2192 "}selector.{" "}
              Use <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>""</code> for element text,{" "}
              <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>@href</code> for element attribute,{" "}
              <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>img @src</code> for child attribute.
            </div>
          </div>
        )}

        {/* Convert */}
        {mode === "convert" && (
          <div>
            <label className="text-xs block mb-2" style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>
              Output format
            </label>
            <div className="flex gap-3">
              {(["markdown", "plaintext"] as const).map(fmt => (
                <label
                  key={fmt}
                  className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2"
                  style={{
                    background: convertFormat === fmt ? "var(--color-primary-glow)" : "transparent",
                    border: `1px solid ${convertFormat === fmt ? "rgba(6, 182, 212, 0.3)" : "var(--color-border)"}`,
                    color: convertFormat === fmt ? "var(--color-primary)" : "var(--color-text-muted)",
                    transition: "all 0.15s ease"
                  }}
                >
                  <input
                    type="radio"
                    name="format"
                    value={fmt}
                    checked={convertFormat === fmt}
                    onChange={() => onConvertFormatChange(fmt)}
                    style={{ accentColor: "var(--color-primary)" }}
                  />
                  <span className="capitalize">{fmt}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
