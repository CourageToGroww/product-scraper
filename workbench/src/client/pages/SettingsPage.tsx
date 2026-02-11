import React, { useState, useEffect } from "react";
import { useSettings, useUpdateSettings } from "../lib/hooks";
import { useToast } from "../components/Toast";

const PROVIDERS = [
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "kimi", label: "Kimi K2 (Moonshot)" }
] as const;

const KEY_FIELDS = [
  { key: "claudeApiKey" as const, label: "Claude API Key", placeholder: "sk-ant-..." },
  { key: "openaiApiKey" as const, label: "OpenAI API Key", placeholder: "sk-..." },
  { key: "geminiApiKey" as const, label: "Gemini API Key", placeholder: "AIza..." },
  { key: "deepseekApiKey" as const, label: "DeepSeek API Key", placeholder: "sk-..." },
  { key: "kimiApiKey" as const, label: "Kimi K2 API Key", placeholder: "sk-..." }
];

type KeyField = typeof KEY_FIELDS[number]["key"];

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const updateMutation = useUpdateSettings();
  const { toast } = useToast();

  const [provider, setProvider] = useState<string>("");
  const [parseMode, setParseMode] = useState<string>("general");
  const [autoparse, setAutoparse] = useState(false);
  const [keys, setKeys] = useState<Record<KeyField, string>>({
    claudeApiKey: "",
    openaiApiKey: "",
    geminiApiKey: "",
    deepseekApiKey: "",
    kimiApiKey: ""
  });
  const [dirty, setDirty] = useState(false);

  // Populate form when data loads
  useEffect(() => {
    if (data) {
      setProvider(data.aiProvider || "");
      setParseMode(data.aiParseMode || "general");
      setAutoparse(data.aiAutoparse);
      // Don't overwrite keys with masked values — leave empty so user sees placeholder
    }
  }, [data]);

  const handleKeyChange = (field: KeyField, value: string) => {
    setKeys(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        aiProvider: provider || null,
        aiParseMode: parseMode,
        aiAutoparse: autoparse
      };

      // Only include keys that user actually typed (non-empty)
      for (const { key } of KEY_FIELDS) {
        if (keys[key].trim()) {
          payload[key] = keys[key].trim();
        }
      }

      await updateMutation.mutateAsync(payload as any);
      setDirty(false);
      // Clear key inputs after save (they'll show as masked placeholders)
      setKeys({
        claudeApiKey: "",
        openaiApiKey: "",
        geminiApiKey: "",
        deepseekApiKey: "",
        kimiApiKey: ""
      });
      toast("Settings saved", "success");
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  if (isLoading) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-6" style={{ color: "var(--color-text)" }}>Settings</h1>
        <div className="card p-6" style={{ color: "var(--color-text-muted)" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="text-xl font-bold mb-6" style={{ color: "var(--color-text)" }}>Settings</h1>

      {/* AI Data Parsing Section */}
      <div className="card" style={{ padding: 0 }}>
        <div className="p-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--color-text)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93" />
              <path d="M8.24 4.85A4 4 0 0 1 12 2" />
              <path d="M5 10c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2z" />
              <path d="M12 14v8" /><path d="M8 22h8" />
            </svg>
            AI Data Parsing
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Configure AI to automatically parse scrape results into structured datasets
          </p>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Provider Select */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              AI Provider
            </label>
            <select
              value={provider}
              onChange={e => { setProvider(e.target.value); setDirty(true); }}
              className="w-full text-sm"
              style={{
                padding: "0.5rem 0.75rem",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
                outline: "none",
                appearance: "auto"
              }}
            >
              <option value="">None (disabled)</option>
              {PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Parse Mode Select */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-muted)" }}>
              Parse Mode
            </label>
            <select
              value={parseMode}
              onChange={e => { setParseMode(e.target.value); setDirty(true); }}
              className="w-full text-sm"
              style={{
                padding: "0.5rem 0.75rem",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
                outline: "none",
                appearance: "auto"
              }}
            >
              {(data?.parseModes || [
                { value: "general", label: "General", description: "Generic extraction" },
                { value: "ecommerce", label: "Ecommerce (Shopify)", description: "Shopify-compatible product data" },
                { value: "articles", label: "Articles / Blog", description: "Blog posts, news, content" },
                { value: "contacts", label: "Contacts / Directory", description: "People and company info" },
                { value: "real_estate", label: "Real Estate", description: "Property listings" },
                { value: "jobs", label: "Jobs", description: "Job postings" }
              ]).map(m => (
                <option key={m.value} value={m.value}>{m.label} — {m.description}</option>
              ))}
            </select>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              Determines the AI prompt and output columns for parsed data
            </p>
          </div>

          {/* Auto-parse Toggle */}
          <label className="flex items-center gap-3 cursor-pointer" style={{ color: "var(--color-text)" }}>
            <div
              onClick={() => { setAutoparse(!autoparse); setDirty(true); }}
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: autoparse ? "var(--color-primary)" : "var(--color-border)",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s ease",
                flexShrink: 0
              }}
            >
              <div style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#fff",
                position: "absolute",
                top: 2,
                left: autoparse ? 18 : 2,
                transition: "left 0.2s ease"
              }} />
            </div>
            <div>
              <span className="text-sm">Auto-parse after scraping</span>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                Automatically create a dataset from AI-extracted data when a scrape completes
              </p>
            </div>
          </label>

          {/* API Keys */}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1rem" }}>
            <h3 className="text-xs font-semibold mb-3" style={{ color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              API Keys
            </h3>
            <div className="flex flex-col gap-3">
              {KEY_FIELDS.map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-muted)" }}>
                    {label}
                    {data?.[key] && (
                      <span className="ml-2" style={{ color: "var(--color-primary)", fontWeight: 400 }}>
                        ({data[key]})
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={keys[key]}
                    onChange={e => handleKeyChange(key, e.target.value)}
                    placeholder={data?.[key] ? "Enter new key to replace" : placeholder}
                    className="w-full text-sm"
                    style={{
                      padding: "0.5rem 0.75rem",
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text)",
                      outline: "none"
                    }}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
            <button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="btn-primary text-sm"
              style={{
                padding: "0.5rem 1.5rem",
                opacity: updateMutation.isPending ? 0.7 : 1
              }}
            >
              {updateMutation.isPending ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>
      </div>

      {/* Info note */}
      <p className="text-xs mt-4" style={{ color: "var(--color-text-muted)" }}>
        API keys are stored locally in your PostgreSQL database and are never sent to any third party except the selected AI provider.
      </p>
    </div>
  );
}
