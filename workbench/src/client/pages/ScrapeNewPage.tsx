import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateScrape } from "../lib/hooks";
import { useToast } from "../components/Toast";
import Tooltip from "../components/Tooltip";
import SyntaxBlock from "../components/SyntaxBlock";
import ExtractionConfigEditor, { type ExtractionMode, CSS_PLACEHOLDER, LIST_PLACEHOLDER, getExtractionConfig } from "../components/ExtractionConfigEditor";
import * as api from "../lib/api";

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section-header">
      <button type="button" onClick={() => setOpen(!open)} className="section-toggle">
        {title}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease", opacity: 0.4 }}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function Label({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <label style={{ color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "2px", fontSize: "0.75rem", marginBottom: "0.25rem", fontWeight: 500 }}>
      {children}
      {tip && <Tooltip text={tip} />}
    </label>
  );
}

type DetectResult = {
  detected: boolean; totalItems?: number; itemsKey?: string; itemsPerPage?: number;
  totalPages?: number; pageParam?: string; suggestedPattern?: string; sample?: unknown;
  responseType: string; responseKeys?: string[];
};

export default function ScrapeNewPage() {
  const navigate = useNavigate();
  const createMutation = useCreateScrape();
  const { toast } = useToast();
  const [error, setError] = useState("");

  // Discovery
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<{ urls: string[]; method: string; count: number } | null>(null);
  const [discoverJsRender, setDiscoverJsRender] = useState(true);

  // Auto-crawl: when ON (default), submitting with a single URL first runs discovery
  // and uses every discovered page. Best fit for documentation / blog / multi-page sites.
  const [autoCrawl, setAutoCrawl] = useState(true);
  const [autoCrawlMaxUrls, setAutoCrawlMaxUrls] = useState("100");

  // API pagination detection
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);

  // Basic
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const [output, setOutput] = useState("json");
  const [autoParse, setAutoParse] = useState("");
  const [extract, setExtract] = useState("");

  // Browser
  const [jsRender, setJsRender] = useState(true);
  const [stealth, setStealth] = useState(false);
  const [device, setDevice] = useState("");
  const [windowWidth, setWindowWidth] = useState("");
  const [windowHeight, setWindowHeight] = useState("");
  const [waitFor, setWaitFor] = useState("");
  const [waitForEvent, setWaitForEvent] = useState("");
  const [waitMs, setWaitMs] = useState("");
  const [blockResources, setBlockResources] = useState<string[]>([]);

  // HTTP / Request
  const [method, setMethod] = useState("GET");
  const [requestBody, setRequestBody] = useState("");
  const [headers, setHeaders] = useState("");
  const [cookie, setCookie] = useState("");
  const [allowedStatus, setAllowedStatus] = useState("");
  const [delay, setDelay] = useState("");
  const [timeout, setTimeout_] = useState("");

  // Anti-bot
  const [antiBot, setAntiBot] = useState(false);
  const [proxy, setProxy] = useState("");
  const [proxyCountry, setProxyCountry] = useState("");
  const [rotateUa, setRotateUa] = useState(false);
  const [session, setSession] = useState(false);
  const [captchaKey, setCaptchaKey] = useState("");

  // Output enhancements
  const [responseType, setResponseType] = useState("html");
  const [screenshot, setScreenshot] = useState("");
  const [screenshotFormat, setScreenshotFormat] = useState("png");
  const [screenshotQuality, setScreenshotQuality] = useState("80");
  const [screenshotBase64, setScreenshotBase64] = useState(false);
  const [pdf, setPdf] = useState(false);

  // JS Automation
  const [jsInstructions, setJsInstructions] = useState("");
  const [jsonResponse, setJsonResponse] = useState("");

  // Auto-Extract
  const [autoExtract, setAutoExtract] = useState(false);
  const [extractMode, setExtractMode] = useState<ExtractionMode>("list");
  const [extractCss, setExtractCss] = useState(CSS_PLACEHOLDER);
  const [extractCategories, setExtractCategories] = useState<Set<string>>(new Set(["headings", "links", "images"]));
  const [extractFormat, setExtractFormat] = useState<"markdown" | "plaintext">("markdown");
  const [extractList, setExtractList] = useState(LIST_PLACEHOLDER);
  const [autoDataset, setAutoDataset] = useState(false);
  const [autoDatasetName, setAutoDatasetName] = useState("");

  const handleDetect = async () => {
    const firstUrl = urls.split("\n").map(u => u.trim()).filter(Boolean)[0];
    if (!firstUrl) { setError("Enter a URL first"); return; }

    // Strip [N-M] pattern for detection fetch
    const cleanUrl = firstUrl.replace(/\[\d+-\d+\]/, "1");
    try { new URL(cleanUrl); } catch { setError("Enter a valid URL first"); return; }

    setDetecting(true);
    setDetectResult(null);
    setError("");
    try {
      const hdrs = headers ? JSON.parse(headers) : undefined;
      const result = await api.scrapes.apiDetect({ url: cleanUrl, headers: hdrs });
      setDetectResult(result);
      if (result.detected && result.suggestedPattern) {
        setUrls(result.suggestedPattern);
        toast(`Pagination detected: ${result.totalPages} pages, ${result.totalItems} items`, "success");
      } else if (result.responseType !== "html") {
        toast(`Response is ${result.responseType}${result.totalItems ? ` with ${result.totalItems} items` : ""}. No pagination detected.`, "info");
      } else {
        toast("No API pagination detected. URL will be scraped as a web page.", "info");
      }
    } catch (err: any) {
      toast(`Detection failed: ${err.message}`, "error");
    }
    setDetecting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    let urlList = urls.split("\n").map(u => u.trim()).filter(Boolean);
    if (!name || urlList.length === 0) {
      setError("Name and at least one URL are required");
      return;
    }

    // Auto-crawl: when ON and the user gave exactly ONE URL, run discovery first
    // and use every discovered page. This is what users typically want for
    // documentation/blog sites (e.g. https://react.dev -> all docs pages).
    if (autoCrawl && urlList.length === 1 && !discoveryResult) {
      const seed = urlList[0];
      const cleanSeed = seed.replace(/\[\d+-\d+\]/g, "1");
      try { new URL(cleanSeed); } catch { setError("Invalid seed URL"); return; }

      setDiscovering(true);
      try {
        const max = Math.max(1, Math.min(parseInt(autoCrawlMaxUrls, 10) || 100, 500));
        const result = await api.scrapes.discover({ url: cleanSeed, jsRender: discoverJsRender, maxUrls: max });
        setDiscoveryResult(result);
        if (result.count > 0) {
          urlList = result.urls;
          setUrls(result.urls.join("\n"));
          toast(`Auto-crawl found ${result.count} pages, scraping all of them`, "success");
        } else {
          toast("Auto-crawl found no extra pages; scraping just the seed URL", "warning");
        }
      } catch (err: any) {
        setDiscovering(false);
        setError(`Auto-crawl failed: ${err.message}. Disable Auto-crawl to scrape only the entered URL.`);
        return;
      }
      setDiscovering(false);
    }

    // Validate URLs (allow [N-M] patterns by stripping them for URL check)
    for (const u of urlList) {
      const clean = u.replace(/\[\d+-\d+\]/g, "1");
      try { new URL(clean); } catch {
        setError(`Invalid URL: ${u}`);
        return;
      }
    }

    if (extract) {
      try { JSON.parse(extract); } catch {
        setError("Invalid CSS extraction JSON");
        return;
      }
    }

    if (jsInstructions) {
      try {
        const parsed = JSON.parse(jsInstructions);
        if (!Array.isArray(parsed)) { setError("JS Instructions must be a JSON array"); return; }
      } catch {
        setError("Invalid JS Instructions JSON");
        return;
      }
    }

    let parsedHeaders: Record<string, string> | undefined;
    if (headers) {
      try { parsedHeaders = JSON.parse(headers); } catch {
        setError("Invalid Headers JSON");
        return;
      }
    }

    // Build options (browser/output/anti-bot — used for web scrape path)
    const options: Record<string, unknown> = {};
    if (jsRender) options.jsRender = true;
    if (stealth) options.stealth = true;
    if (method !== "GET") options.method = method;
    if (requestBody) options.requestBody = requestBody;
    if (device) options.device = device;
    if (windowWidth) options.windowWidth = parseInt(windowWidth, 10);
    if (windowHeight) options.windowHeight = parseInt(windowHeight, 10);
    if (waitFor) options.waitFor = waitFor;
    if (waitForEvent) options.waitForEvent = waitForEvent;
    if (waitMs) options.wait = parseInt(waitMs, 10);
    if (blockResources.length > 0) options.blockResources = blockResources;
    if (cookie) options.cookie = cookie;
    if (allowedStatus) options.allowedStatus = allowedStatus;
    if (antiBot) options.antiBot = true;
    if (proxy) options.proxy = proxy;
    if (proxyCountry) options.proxyCountry = proxyCountry;
    if (rotateUa) options.rotateUa = true;
    if (session) options.session = true;
    if (captchaKey) options.captchaKey = captchaKey;
    if (responseType !== "html") options.responseType = responseType;
    if (screenshot) options.screenshot = screenshot;
    if (screenshot && screenshotFormat !== "png") options.screenshotFormat = screenshotFormat;
    if (screenshot && screenshotFormat === "jpeg" && screenshotQuality !== "80") options.screenshotQuality = parseInt(screenshotQuality, 10);
    if (screenshotBase64) options.screenshotBase64 = true;
    if (pdf) options.pdf = true;
    if (jsInstructions) options.jsInstructions = JSON.parse(jsInstructions);
    if (jsonResponse) options.jsonResponse = jsonResponse.split(",").map(s => s.trim()).filter(Boolean);

    // Build extraction config if enabled
    let extractionConfig: { mode: string; config: Record<string, unknown>; datasetName?: string } | undefined;
    if (autoExtract) {
      const extConf = getExtractionConfig(
        { mode: extractMode, cssSchema: extractCss, categories: extractCategories, convertFormat: extractFormat, listConfig: extractList },
        (msg) => { setError(msg); }
      );
      if (!extConf) return;
      extractionConfig = {
        mode: extractMode,
        config: extConf,
        ...(autoDataset && autoDatasetName.trim() ? { datasetName: autoDatasetName.trim() } : {})
      };
    }

    try {
      // Unified payload — backend auto-detects API vs web from first URL
      const job = await createMutation.mutateAsync({
        name,
        urls: urlList,
        options,
        scrapeOpts: {
          output,
          ...(autoParse ? { autoParse } : {}),
          ...(extract ? { extract } : {})
        },
        ...(extractionConfig ? { extractionConfig } : {}),
        ...(parsedHeaders ? { headers: parsedHeaders } : {}),
        ...(delay ? { delay: parseInt(delay, 10) } : {}),
        ...(timeout ? { timeout: parseInt(timeout, 10) } : {})
      });
      navigate(`/scrapes/${job.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const resourceTypes = ["images", "fonts", "css", "media", "script"];

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="grid gap-2">
        {/* Job name */}
        <div>
          <Label tip="A unique name to identify this scrape job">Job Name *</Label>
          <input className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="my-scrape" />
        </div>

        {/* URLs */}
        <div>
          <Label tip="Enter one URL per line. Supports [N-M] range patterns for paginated APIs, e.g. ?page=[1-50]">URLs / Patterns *</Label>
          <textarea
            className="input-field"
            style={{ minHeight: "5rem", resize: "vertical", fontFamily: "monospace", fontSize: "0.8rem" }}
            value={urls}
            onChange={e => { setUrls(e.target.value); setDiscoveryResult(null); setDetectResult(null); }}
            placeholder={"https://example.com\nhttps://api.example.com/products?page=[1-50]"}
          />
          <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Use <code className="text-xs px-1 py-0.5" style={{ background: "var(--color-surface-glass)" }}>[1-50]</code> patterns for paginated endpoints. Type is auto-detected (API or web page).
          </div>
        </div>

        {/* Auto-crawl: default ON. When user enters one seed URL, automatically discover
            and scrape every linked page. Best fit for docs/blogs/multi-page sites. */}
        <div className="glass-card p-3" style={{ borderLeft: "3px solid var(--color-primary)" }}>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
            <input
              type="checkbox"
              checked={autoCrawl}
              onChange={e => setAutoCrawl(e.target.checked)}
              style={{ accentColor: "var(--color-primary)" }}
            />
            <span style={{ fontWeight: 600 }}>Auto-crawl entire site (recommended)</span>
            <Tooltip text="When you enter a single seed URL, automatically discover and scrape every linked page on the same site. Disable to scrape only the URLs you entered." />
          </label>
          {autoCrawl && (
            <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "auto 1fr" }}>
              <Label tip="Hard cap on the number of pages discovered + scraped">Max pages</Label>
              <input
                className="input-field"
                type="number"
                min="1"
                max="500"
                value={autoCrawlMaxUrls}
                onChange={e => setAutoCrawlMaxUrls(e.target.value)}
                style={{ width: "8rem" }}
              />
              <div className="text-xs" style={{ color: "var(--color-text-muted)", gridColumn: "1 / -1" }}>
                Discovery runs on submit. Defaults to JS Rendering ON for SPAs (React, Vue, Next.js, etc.). To pick specific URLs by hand, click "Discover Pages" above first or paste them into the URL box and turn this off.
              </div>
            </div>
          )}
        </div>

        {/* Helper buttons: Discover + Auto-Detect Pagination */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={discovering}
            onClick={async () => {
              const firstUrl = urls.split("\n").map(u => u.trim()).filter(Boolean)[0];
              if (!firstUrl) { setError("Enter a URL first"); return; }
              const clean = firstUrl.replace(/\[\d+-\d+\]/g, "1");
              try { new URL(clean); } catch { setError("Enter a valid URL first"); return; }

              setDiscovering(true);
              setDiscoveryResult(null);
              setError("");
              try {
                const result = await api.scrapes.discover({ url: clean, jsRender: discoverJsRender });
                setDiscoveryResult(result);
                if (result.count === 0) {
                  toast("No pages found. Try entering URLs manually.", "warning");
                }
              } catch (err: any) {
                toast(`Discovery failed: ${err.message}`, "error");
              }
              setDiscovering(false);
            }}
            className="btn-primary"
            style={{ fontSize: "0.8rem", padding: "0.45rem 1rem" }}
          >
            {discovering ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Discovering...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                Discover Pages
              </>
            )}
          </button>
          <button
            type="button"
            disabled={detecting}
            onClick={handleDetect}
            className="btn-primary"
            style={{ fontSize: "0.8rem", padding: "0.45rem 1rem", background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
          >
            {detecting ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Detecting...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                Detect Pagination
              </>
            )}
          </button>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-text-muted)" }}>
            <input
              type="checkbox"
              checked={discoverJsRender}
              onChange={e => setDiscoverJsRender(e.target.checked)}
              style={{ accentColor: "var(--color-primary)", width: 12, height: 12 }}
            />
            JS Rendering
            <Tooltip text="Use headless browser for discovery (slower but catches SPA navigation)" />
          </label>
        </div>

        {/* Discovery result */}
        {discoveryResult && discoveryResult.count > 0 && (
          <div className="glass-card p-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-xs">
                <span style={{ color: "var(--color-success)", fontWeight: 600 }}>
                  {discoveryResult.count} pages found
                </span>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {" "}via {discoveryResult.method}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUrls(discoveryResult.urls.join("\n"));
                  toast(`${discoveryResult.count} URLs loaded`, "success");
                }}
                className="btn-primary"
                style={{ fontSize: "0.85rem", padding: "0.45rem 1rem" }}
              >
                Use All {discoveryResult.count} URLs
              </button>
            </div>
            <div
              className="text-xs font-mono overflow-auto"
              style={{
                maxHeight: "150px",
                color: "var(--color-text-muted)",
                background: "var(--color-surface)",
                borderRadius: "var(--radius)",
                padding: "0.5rem",
                lineHeight: "1.6",
                border: "1px solid var(--color-border)"
              }}
            >
              {discoveryResult.urls.map((u, i) => (
                <div key={i}>{u}</div>
              ))}
            </div>
          </div>
        )}

        {/* Pagination detection result */}
        {detectResult && (
          <div className="glass-card p-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="badge badge-completed">{detectResult.responseType}</span>
                {detectResult.detected && <span className="badge badge-running">pagination detected</span>}
              </div>
              <div className="grid grid-cols-2 gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                {detectResult.totalItems != null && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>Total Items</div>
                    <div className="text-sm font-bold">{detectResult.totalItems.toLocaleString()}</div>
                  </div>
                )}
                {detectResult.itemsKey && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>Items Key</div>
                    <div className="text-sm font-mono">{detectResult.itemsKey}</div>
                  </div>
                )}
                {detectResult.itemsPerPage != null && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>Per Page</div>
                    <div className="text-sm font-bold">{detectResult.itemsPerPage}</div>
                  </div>
                )}
                {detectResult.totalPages != null && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>Pages</div>
                    <div className="text-sm font-bold">{detectResult.totalPages}</div>
                  </div>
                )}
                {detectResult.pageParam && (
                  <div>
                    <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>Page Param</div>
                    <div className="text-sm font-mono">{detectResult.pageParam}</div>
                  </div>
                )}
              </div>
              {detectResult.responseKeys && detectResult.responseKeys.length > 0 && (
                <div>
                  <div className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Response Keys</div>
                  <div className="flex gap-1 flex-wrap">
                    {detectResult.responseKeys.map(k => (
                      <span key={k} className="text-xs px-1.5 py-0.5" style={{
                        background: k === detectResult.itemsKey ? "rgba(var(--color-primary-rgb, 99, 102, 241), 0.15)" : "var(--color-surface-glass)",
                        color: k === detectResult.itemsKey ? "var(--color-primary)" : "var(--color-text-muted)",
                        border: `1px solid ${k === detectResult.itemsKey ? "var(--color-primary)" : "var(--color-border)"}`,
                        fontFamily: "monospace"
                      }}>
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {detectResult.sample && (
                <div>
                  <div className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>Sample Item</div>
                  <SyntaxBlock code={JSON.stringify(detectResult.sample, null, 2)} maxHeight="120px" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Output & Parse */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label tip="How results are saved: JSON (structured), CSV (spreadsheet), Markdown, etc.">Output Format</Label>
            <select className="input-field" value={output} onChange={e => setOutput(e.target.value)}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="markdown">Markdown</option>
              <option value="text">Text</option>
              <option value="html">HTML</option>
              <option value="json,csv">JSON + CSV</option>
            </select>
          </div>
          <div>
            <Label tip="Automatically extract structured data from HTML: emails, phone numbers, links, tables, images">Auto-Parse</Label>
            <select className="input-field" value={autoParse} onChange={e => setAutoParse(e.target.value)}>
              <option value="">None</option>
              <option value="all">All</option>
              <option value="emails,phones,links">Emails, Phones, Links</option>
              <option value="tables,metadata">Tables, Metadata</option>
              <option value="images,videos">Media</option>
            </select>
          </div>
        </div>

        <div>
          <Label tip="JSON mapping of field names to CSS selectors, e.g. {&quot;title&quot;:&quot;h1&quot;, &quot;price&quot;:&quot;.price&quot;}">CSS Extraction Schema</Label>
          <input className="input-field" value={extract} onChange={e => setExtract(e.target.value)} placeholder='{"title":"h1","price":".price","desc":".description"}' />
        </div>

        {/* Request Options */}
        <Section title="Request Options">
          <div>
            <Label tip="JSON object of HTTP headers, e.g. {&quot;Authorization&quot;: &quot;Bearer token123&quot;}">Custom Headers (JSON)</Label>
            <input className="input-field" value={headers} onChange={e => setHeaders(e.target.value)}
              placeholder='{"Accept": "application/json", "Authorization": "Bearer ..."}' />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label tip="HTTP method for the request">Method</Label>
              <select className="input-field" value={method} onChange={e => setMethod(e.target.value)}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
                <option value="HEAD">HEAD</option>
              </select>
            </div>
            <div>
              <Label tip="Comma-separated status codes to accept as successful">Allowed Status Codes</Label>
              <input className="input-field" value={allowedStatus} onChange={e => setAllowedStatus(e.target.value)} placeholder="200,301,404" />
            </div>
          </div>
          {method !== "GET" && method !== "HEAD" && (
            <div>
              <Label tip="Body payload for POST/PUT/PATCH requests">Request Body</Label>
              <textarea
                className="input-field"
                style={{ minHeight: "3rem", resize: "vertical", fontFamily: "monospace", fontSize: "0.8rem" }}
                value={requestBody}
                onChange={e => setRequestBody(e.target.value)}
                placeholder='{"key": "value"}'
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label tip="Milliseconds to wait between each request. Prevents rate limiting">Delay (ms)</Label>
              <input className="input-field" type="number" min="0" max="10000" value={delay} onChange={e => setDelay(e.target.value)} placeholder="200" />
            </div>
            <div>
              <Label tip="Maximum milliseconds to wait for each request before aborting">Timeout (ms)</Label>
              <input className="input-field" type="number" min="1000" max="120000" value={timeout} onChange={e => setTimeout_(e.target.value)} placeholder="30000" />
            </div>
          </div>
          <div>
            <Label tip="Cookie string sent with each request, e.g. &quot;session=abc; token=xyz&quot;">Cookie</Label>
            <input className="input-field" value={cookie} onChange={e => setCookie(e.target.value)} placeholder="session=abc123; token=xyz" />
          </div>
        </Section>

        {/* Browser Options */}
        <Section title="Browser Options">
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input type="checkbox" checked={jsRender} onChange={e => setJsRender(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> JS Rendering
              <Tooltip text="Enable headless browser (Puppeteer) to execute JavaScript. Required for SPAs and dynamic content" />
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input type="checkbox" checked={stealth} onChange={e => setStealth(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> Stealth Mode
              <Tooltip text="Applies anti-detection patches to avoid bot fingerprinting" />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label tip="Emulate a mobile, tablet, or desktop device viewport and user-agent">Device</Label>
              <select className="input-field" value={device} onChange={e => setDevice(e.target.value)}>
                <option value="">Default (Desktop)</option>
                <option value="mobile">Mobile</option>
                <option value="tablet">Tablet</option>
                <option value="desktop">Desktop</option>
              </select>
            </div>
            <div>
              <Label tip="Custom viewport width in pixels">Width (px)</Label>
              <input className="input-field" type="number" value={windowWidth} onChange={e => setWindowWidth(e.target.value)} placeholder="1920" />
            </div>
            <div>
              <Label tip="Custom viewport height in pixels">Height (px)</Label>
              <input className="input-field" type="number" value={windowHeight} onChange={e => setWindowHeight(e.target.value)} placeholder="1080" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label tip="CSS selector to wait for before capturing content">Wait For Selector</Label>
              <input className="input-field" value={waitFor} onChange={e => setWaitFor(e.target.value)} placeholder=".content-loaded" />
            </div>
            <div>
              <Label tip="Browser event to wait for: load, networkidle0, etc.">Wait For Event</Label>
              <select className="input-field" value={waitForEvent} onChange={e => setWaitForEvent(e.target.value)}>
                <option value="">Default (networkidle2)</option>
                <option value="load">load</option>
                <option value="domcontentloaded">domcontentloaded</option>
                <option value="networkidle0">networkidle0</option>
                <option value="networkidle2">networkidle2</option>
                <option value="requestsfinished">requestsfinished</option>
              </select>
            </div>
            <div>
              <Label tip="Additional milliseconds to wait after the page event fires">Wait Delay (ms)</Label>
              <input className="input-field" type="number" value={waitMs} onChange={e => setWaitMs(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <Label tip="Prevent loading of resource types to speed up rendering">Block Resources</Label>
            <div className="flex gap-3 flex-wrap">
              {resourceTypes.map(rt => (
                <label key={rt} className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-text)" }}>
                  <input
                    type="checkbox"
                    checked={blockResources.includes(rt)}
                    style={{ accentColor: "var(--color-primary)" }}
                    onChange={e => {
                      if (e.target.checked) setBlockResources([...blockResources, rt]);
                      else setBlockResources(blockResources.filter(r => r !== rt));
                    }}
                  />
                  {rt}
                </label>
              ))}
            </div>
          </div>
        </Section>

        {/* Anti-Bot & Proxy */}
        <Section title="Anti-Bot & Proxy">
          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input type="checkbox" checked={antiBot} onChange={e => setAntiBot(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> Adaptive Anti-Bot
              <Tooltip text="Auto-detects and bypasses WAFs: Cloudflare, DataDome, PerimeterX, Akamai, etc." />
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input type="checkbox" checked={rotateUa} onChange={e => setRotateUa(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> Rotate User-Agent
              <Tooltip text="Randomize the User-Agent header on each request" />
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input type="checkbox" checked={session} onChange={e => setSession(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> Session Mode
              <Tooltip text="Reuse the same browser session across requests" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label tip="Route requests through a proxy server">Proxy URL</Label>
              <input className="input-field" value={proxy} onChange={e => setProxy(e.target.value)} placeholder="http://user:pass@host:port" />
            </div>
            <div>
              <Label tip="Two-letter country code for proxy geotargeting">Proxy Country</Label>
              <input className="input-field" value={proxyCountry} onChange={e => setProxyCountry(e.target.value)} placeholder="us" maxLength={2} />
            </div>
          </div>
          <div>
            <Label tip="Your 2Captcha API key for automatic CAPTCHA solving">CAPTCHA API Key</Label>
            <input className="input-field" type="password" value={captchaKey} onChange={e => setCaptchaKey(e.target.value)} placeholder="Enter your 2Captcha API key" />
          </div>
        </Section>

        {/* Output Enhancements */}
        <Section title="Output Enhancements">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label tip="Convert HTML response to Markdown or Plaintext">Response Type</Label>
              <select className="input-field" value={responseType} onChange={e => setResponseType(e.target.value)}>
                <option value="html">HTML (default)</option>
                <option value="markdown">Markdown</option>
                <option value="plaintext">Plaintext</option>
              </select>
            </div>
            <div>
              <Label tip="Capture a screenshot of the rendered page (requires JS Rendering)">Screenshot</Label>
              <select className="input-field" value={screenshot} onChange={e => setScreenshot(e.target.value)}>
                <option value="">None</option>
                <option value="fullpage">Full Page</option>
                <option value="abovefold">Above Fold</option>
              </select>
            </div>
          </div>
          {screenshot && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label tip="Screenshot image format">Format</Label>
                <select className="input-field" value={screenshotFormat} onChange={e => setScreenshotFormat(e.target.value)}>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </div>
              <div>
                <Label tip="JPEG compression quality (1-100)">Quality</Label>
                <input className="input-field" type="number" min="1" max="100" value={screenshotQuality} onChange={e => setScreenshotQuality(e.target.value)} />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm cursor-pointer pb-2" style={{ color: "var(--color-text)" }}>
                  <input type="checkbox" checked={screenshotBase64} onChange={e => setScreenshotBase64(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> Return as Base64
                </label>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
            <input type="checkbox" checked={pdf} onChange={e => setPdf(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} /> Generate PDF
            <Tooltip text="Save the rendered page as a PDF document (requires JS Rendering)" />
          </label>
        </Section>

        {/* JS Automation */}
        <Section title="JS Automation">
          <div>
            <Label tip="JSON array of browser automation steps: click, type, scroll, wait, etc.">JS Instructions</Label>
            <textarea
              className="input-field"
              style={{ minHeight: "4rem", resize: "vertical", fontFamily: "monospace", fontSize: "0.8rem" }}
              value={jsInstructions}
              onChange={e => setJsInstructions(e.target.value)}
              placeholder='[{"action":"click","selector":"#button"},{"action":"wait","timeout":1000}]'
            />
          </div>
          <div>
            <Label tip="Intercept XHR/fetch requests matching these URL patterns and save their responses">Network Capture</Label>
            <input className="input-field" value={jsonResponse} onChange={e => setJsonResponse(e.target.value)} placeholder="api,graphql,/v1/" />
          </div>
        </Section>

        {/* Auto-Extract */}
        <Section title="Auto-Extract After Scraping">
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input type="checkbox" checked={autoExtract} onChange={e => setAutoExtract(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
              Extract data after scraping
              <Tooltip text="Automatically run extraction on scraped HTML to create structured data" />
            </label>
          </div>
          {autoExtract && (
            <>
              <div className="glass-card overflow-hidden mb-3">
                <ExtractionConfigEditor
                  mode={extractMode}
                  onModeChange={setExtractMode}
                  cssSchema={extractCss}
                  onCssSchemaChange={setExtractCss}
                  categories={extractCategories}
                  onCategoriesChange={setExtractCategories}
                  convertFormat={extractFormat}
                  onConvertFormatChange={setExtractFormat}
                  listConfig={extractList}
                  onListConfigChange={setExtractList}
                  compact
                />
              </div>
              <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--color-text)" }}>
                  <input type="checkbox" checked={autoDataset} onChange={e => setAutoDataset(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
                  Auto-create dataset
                  <Tooltip text="Automatically create a dataset from the extraction results when the scrape completes" />
                </label>
              </div>
              {autoDataset && (
                <div>
                  <Label>Dataset Name</Label>
                  <input
                    className="input-field"
                    value={autoDatasetName}
                    onChange={e => setAutoDatasetName(e.target.value)}
                    placeholder="My extracted data"
                  />
                </div>
              )}
            </>
          )}
        </Section>

        {error && (
          <div className="glass-card p-3 flex items-center gap-2" style={{ borderLeft: "3px solid var(--color-error)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            <span className="text-sm" style={{ color: "var(--color-error)" }}>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={createMutation.isPending} className="btn-primary">
            {createMutation.isPending ? "Starting..." : "Start Scrape"}
          </button>
          <button type="button" onClick={() => navigate("/scrapes")} className="btn-ghost">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
