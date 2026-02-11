const fs = require("fs");
const path = require("path");
const HttpClient = require("../core/http-client");
const CssExtractor = require("../extractors/css-extractor");
const AutoParser = require("../extractors/auto-parser");
const JsonOutput = require("../outputs/json-output");
const CsvOutput = require("../outputs/csv-output");
const MarkdownOutput = require("../outputs/markdown-output");
const TextOutput = require("../outputs/text-output");
const OutputManager = require("../utils/output-manager");
const RateLimiter = require("../utils/rate-limiter");
const ImageDownloader = require("../utils/image-downloader");
const UserAgentRotator = require("../anti-bot/user-agent-rotator");
const ProxyRotator = require("../anti-bot/proxy-rotator");

class GenericScraper {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.logger = options.logger || console;
    this.onProgress = options.onProgress || null;
    this.outputManager = new OutputManager(options.outputBase || "./output");

    // Stealth mode: force browser + session + UA rotation
    if (options.stealth) {
      options.jsRender = true;
      options.session = true;
      options.rotateUa = true;
    }

    // JS instructions, JSON response, device emulation all require browser mode
    if (options.jsInstructions || options.jsonResponse || options.device || options.antiBot) {
      options.jsRender = true;
    }

    // Anti-bot
    const uaRotator = options.rotateUa ? new UserAgentRotator() : null;
    let proxyRotator = null;
    if (options.proxyFile) {
      proxyRotator = new ProxyRotator(options.proxyFile);
    } else if (options.proxy) {
      proxyRotator = new ProxyRotator([options.proxy]);
    }

    // Geotargeting: rewrite proxy URLs with country
    if (options.proxyCountry && proxyRotator) {
      const Geotargeting = require("../anti-bot/geotargeting");
      const geo = new Geotargeting(options.proxyCountry);
      proxyRotator.proxies = geo.rewriteAll(proxyRotator.proxies);
      if (this.verbose) this.logger.log(`  Geotargeting: ${options.proxyCountry.toUpperCase()} (${proxyRotator.count()} proxies rewritten)`);
    }

    // Session manager
    this.sessionManager = null;
    if (options.session) {
      const SessionManager = require("../core/session-manager");
      this.sessionManager = new SessionManager({
        userAgentRotator: uaRotator,
        proxyRotator,
        sessionFile: options.sessionFile || null,
        verbose: this.verbose
      }).initialize();

      // Seed session with --cookie value if provided
      if (options.cookie && options.url) {
        this.sessionManager.setCookie(options.url, "__seed", options.cookie);
      }
    }

    // Captcha solver
    this.captchaSolver = null;
    const captchaKey = options.captchaKey || process.env.CAPTCHA_API_KEY;
    if (captchaKey) {
      const CaptchaSolver = require("../anti-bot/captcha-solver");
      this.captchaSolver = new CaptchaSolver({
        apiKey: captchaKey,
        verbose: this.verbose
      });
    }

    // Adaptive anti-bot bypass
    this.adaptiveBypass = null;
    if (options.antiBot) {
      const AdaptiveBypass = require("../anti-bot/adaptive-bypass");
      this.adaptiveBypass = new AdaptiveBypass({
        verbose: this.verbose,
        captchaSolver: this.captchaSolver
      });
    }

    // Response type conversion
    this.responseType = options.responseType || null;
    this.responseConverter = null;
    if (this.responseType && this.responseType !== "html") {
      const ResponseConverter = require("../core/response-converter");
      this.responseConverter = new ResponseConverter();
    }

    // Screenshot base64 mode
    this.screenshotBase64 = options.screenshotBase64 || false;

    // Browser options
    this.screenshotMode = options.screenshot || null;
    this.screenshotFormat = options.screenshotFormat || "png";
    this.screenshotQuality = options.screenshotQuality || 80;
    this.pdfEnabled = options.pdf || false;
    const needsBrowser = options.jsRender || this.screenshotMode || this.pdfEnabled;

    // Parse allowed status codes
    this.allowedStatus = null;
    if (options.allowedStatus) {
      this.allowedStatus = Array.isArray(options.allowedStatus)
        ? options.allowedStatus.map(Number)
        : String(options.allowedStatus).split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    }

    // Build client options, preferring sessionManager when active
    const clientOpts = {
      timeout: options.timeout || 30000,
      headers: options.headers || {},
      cookies: this.sessionManager ? null : (options.cookie || null),
      proxy: this.sessionManager ? null : (options.proxy || null),
      userAgentRotator: this.sessionManager ? null : uaRotator,
      proxyRotator: this.sessionManager ? null : proxyRotator,
      sessionManager: this.sessionManager,
      allowedStatus: this.allowedStatus,
      method: options.method || "GET",
      requestBody: options.requestBody || null,
      verbose: this.verbose
    };

    // Client selection
    if (needsBrowser) {
      const BrowserClient = require("../core/browser-client");
      this.httpClient = new BrowserClient({
        ...clientOpts,
        blockResources: options.blockResources || [],
        waitForSelector: options.waitFor || null,
        waitForEvent: options.waitForEvent || null,
        waitMs: options.wait || 0,
        jsInstructions: options.jsInstructions || null,
        jsonResponse: options.jsonResponse || null,
        device: options.device || null,
        windowWidth: options.windowWidth ? parseInt(options.windowWidth, 10) : null,
        windowHeight: options.windowHeight ? parseInt(options.windowHeight, 10) : null
      });
    } else {
      this.httpClient = new HttpClient({
        ...clientOpts,
        retries: options.retry || 3
      });
    }

    // Screenshot + PDF outputs (lazy loaded only when needed)
    if (this.screenshotMode) {
      const ScreenshotOutput = require("../outputs/screenshot-output");
      this.screenshotOutput = new ScreenshotOutput(this.outputManager);
    }
    if (this.pdfEnabled) {
      const PdfOutput = require("../outputs/pdf-output");
      this.pdfOutput = new PdfOutput(this.outputManager);
    }

    // Rate limiter
    this.rateLimiter = new RateLimiter({
      concurrency: options.concurrency || 3,
      delay: options.delay || 200
    });

    // Extractors
    this.cssExtractor = new CssExtractor();
    this.autoParser = new AutoParser();

    // Outputs
    this.jsonOutput = new JsonOutput(this.outputManager);
    this.csvOutput = new CsvOutput(this.outputManager);
    this.markdownOutput = new MarkdownOutput(this.outputManager);
    this.textOutput = new TextOutput(this.outputManager);

    // Image downloader
    this.imageDownloader = new ImageDownloader({ delay: 100 });

    this.options = options;
  }

  /**
   * Scrape one or more URLs.
   * @param {string|string[]} input - URL, array of URLs, or path to file with URLs
   * @param {object} opts - Scrape options
   */
  async scrape(input, opts = {}) {
    const urls = this._resolveUrls(input);
    const name = opts.name || this._nameFromUrl(urls[0]);
    const outputDir = this.outputManager.getOutputDir(name);
    this.outputManager.ensureDir(outputDir);

    const outputFormats = (opts.output || "json").split(",").map(s => s.trim());
    const extractSchema = opts.extract ? JSON.parse(opts.extract) : null;
    const autoParseFilters = opts.autoParse
      ? opts.autoParse.split(",").map(s => s.trim())
      : null;
    const downloadImages = opts.downloadImages || false;

    this.logger.log(`\nScraping ${urls.length} URL(s) → ${outputDir}/`);
    if (extractSchema) this.logger.log(`  CSS extraction: ${Object.keys(extractSchema).join(", ")}`);
    if (autoParseFilters) this.logger.log(`  Auto-parse: ${autoParseFilters.join(", ")}`);
    if (this.screenshotMode) this.logger.log(`  Screenshot: ${this.screenshotMode} (${this.screenshotFormat})`);
    if (this.pdfEnabled) this.logger.log(`  PDF: enabled`);
    if (this.options.jsInstructions) this.logger.log(`  JS instructions: ${this.options.jsInstructions.length} action(s)`);
    if (this.options.jsonResponse) this.logger.log(`  JSON response capture: ${Array.isArray(this.options.jsonResponse) ? this.options.jsonResponse.join(", ") : "all"}`);
    if (this.options.method && this.options.method !== "GET") this.logger.log(`  HTTP method: ${this.options.method}`);
    if (this.options.device) this.logger.log(`  Device: ${this.options.device}`);
    if (this.options.windowWidth || this.options.windowHeight) this.logger.log(`  Viewport: ${this.options.windowWidth || "auto"}x${this.options.windowHeight || "auto"}`);
    if (this.responseType) this.logger.log(`  Response type: ${this.responseType}`);
    if (this.screenshotBase64) this.logger.log(`  Screenshot: base64 inline`);
    if (this.adaptiveBypass) this.logger.log(`  Anti-bot: adaptive mode`);
    if (this.allowedStatus) this.logger.log(`  Allowed status codes: ${this.allowedStatus.join(", ")}`);
    if (this.sessionManager) this.logger.log(`  Session: ${this.sessionManager.summary().sessionId.substring(0, 8)}...`);
    if (this.captchaSolver) this.logger.log(`  Captcha solver: enabled`);
    this.logger.log(`  Output: ${outputFormats.join(", ")}`);
    this.logger.log();

    const results = [];

    try {
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        this.logger.log(`[${i + 1}/${urls.length}] ${url}`);
        this._emitProgress("url:start", { urlIndex: i, totalUrls: urls.length, url });

        try {
          const pageResult = await this.rateLimiter.execute(() => this._scrapePage(url, {
            extractSchema,
            autoParseFilters,
            downloadImages,
            outputDir,
            name
          }));
          results.push(pageResult);
          this._emitProgress("url:done", { urlIndex: i, totalUrls: urls.length, url, data: pageResult });
        } catch (err) {
          this.logger.error(`  Error: ${err.message}`);
          results.push({ url, error: err.message });
          this._emitProgress("error", { urlIndex: i, totalUrls: urls.length, url, data: { error: err.message } });
        }
      }
    } finally {
      // Save session state before cleanup
      if (this.sessionManager) {
        this.sessionManager.save();
        if (this.verbose) {
          const s = this.sessionManager.summary();
          this.logger.log(`\n  Session summary: ${s.requestCount} requests, ${s.cookieCount} cookies, age ${s.age}`);
        }
      }

      // Close browser if one was opened
      if (this.httpClient.close) {
        await this.httpClient.close();
      }
    }

    // Write output files
    const scrapeData = {
      scraped_at: new Date().toISOString(),
      urls_scraped: urls.length,
      results_count: results.filter(r => !r.error).length,
      errors_count: results.filter(r => r.error).length,
      results
    };

    const written = [];

    for (const fmt of outputFormats) {
      switch (fmt) {
        case "json":
          written.push(this.jsonOutput.write(scrapeData, outputDir, `${name}.json`));
          break;
        case "csv": {
          const flatResults = results.filter(r => !r.error).map(r => ({
            url: r.url,
            status: r.status,
            title: r.extracted?.title || r.autoparse?.metadata?.title || "",
            ...this._flattenForCsv(r)
          }));
          written.push(this.csvOutput.write(flatResults, outputDir, `${name}.csv`));
          break;
        }
        case "markdown":
          for (const r of results) {
            if (r.html) {
              const slug = this._nameFromUrl(r.url);
              written.push(this.markdownOutput.write(r.html, outputDir, `${slug}.md`));
            }
          }
          break;
        case "text":
          for (const r of results) {
            if (r.html) {
              const slug = this._nameFromUrl(r.url);
              written.push(this.textOutput.write(r.html, outputDir, `${slug}.txt`));
            }
          }
          break;
        case "html":
          for (const r of results) {
            if (r.html) {
              const slug = this._nameFromUrl(r.url);
              const res = this.outputManager.writeFile(outputDir, `${slug}.html`, r.html);
              written.push({ format: "html", ...res });
            }
          }
          break;
      }
    }

    // Add screenshot/PDF files to summary
    for (const r of results) {
      if (r.screenshot) written.push(r.screenshot);
      if (r.pdf) written.push(r.pdf);
    }

    this.logger.log(`\nDone! Output saved to ${outputDir}/`);
    for (const w of written) {
      this.logger.log(`  ${path.basename(w.filepath)} (${this.outputManager.formatSize(w.size)})`);
    }

    this._emitProgress("complete", { data: { outputDir, totalUrls: urls.length, results: scrapeData.results_count, errors: scrapeData.errors_count } });
    return { outputDir, results: scrapeData, written };
  }

  async _scrapePage(url, { extractSchema, autoParseFilters, downloadImages, outputDir, name }) {
    let response = await this.httpClient.fetch(url);
    const page = response._page || null;

    try {
      // Adaptive anti-bot detection and bypass (browser mode only)
      if (this.adaptiveBypass && page) {
        const detection = this.adaptiveBypass.detect(response.html, response.headers, response.status);
        if (detection) {
          this.logger.log(`  Anti-bot detected: ${detection.type} (${(detection.confidence * 100).toFixed(0)}% confidence)`);
          const bypassResult = await this.adaptiveBypass.applyBypass(page, detection, url);
          if (bypassResult.bypassed) {
            this.logger.log(`  Anti-bot bypassed via ${bypassResult.strategy}`);
            // Re-read HTML after bypass
            response.html = await page.content();
            response.status = 200; // Challenge was passed
          } else {
            this.logger.log(`  Anti-bot: ${bypassResult.strategy} (may not have fully bypassed)`);
            response.html = await page.content();
          }
        }
      }

      // Captcha solving (browser mode only)
      if (this.captchaSolver && page && this.httpClient.solveCaptchaIfPresent) {
        const captchaResult = await this.httpClient.solveCaptchaIfPresent(page, url, this.captchaSolver);
        if (captchaResult) {
          this.logger.log(`  Captcha solved (${captchaResult.type})`);
          response.html = await page.content();
        }
      } else if (this.captchaSolver && !page) {
        const html = response.html || "";
        const hasCaptcha = /class=["']g-recaptcha["']|class=["']h-captcha["']|class=["']cf-turnstile["']|grecaptcha\.execute/i.test(html);
        if (hasCaptcha) {
          this.logger.log(`  Warning: Captcha detected but --js-render is required to solve it`);
        }
      }

      // Response type conversion (markdown/plaintext)
      let convertedContent = null;
      if (this.responseConverter && response.html) {
        convertedContent = this.responseConverter.convert(response.html, this.responseType);
      }

      const pageResult = {
        url,
        status: response.status,
        originalStatus: response.originalStatus || response.status,
        timing: response.timing,
        html: response.html,
        convertedContent,
        responseType: this.responseType || "html",
        networkRequests: response.networkRequests || null
      };

      // CSS extraction
      if (extractSchema) {
        pageResult.extracted = this.cssExtractor.extract(response.html, extractSchema);
        this._emitProgress("extract:done", { url, data: pageResult.extracted });
        if (this.verbose) {
          this.logger.log(`  Extracted: ${JSON.stringify(pageResult.extracted).substring(0, 200)}`);
        }
      }

      // Auto-parse
      if (autoParseFilters) {
        pageResult.autoparse = this.autoParser.parse(response.html, autoParseFilters);
        if (this.verbose) {
          for (const [k, v] of Object.entries(pageResult.autoparse)) {
            const count = Array.isArray(v) ? v.length : Object.keys(v).length;
            this.logger.log(`  ${k}: ${count} items`);
          }
        }
      }

      // Download images
      if (downloadImages) {
        const images = this.autoParser.parse(response.html, ["images"]).images || [];
        const imageUrls = images.map(img => {
          const src = img.src;
          if (src.startsWith("//")) return "https:" + src;
          if (src.startsWith("/")) {
            const urlObj = new URL(url);
            return urlObj.origin + src;
          }
          return src;
        }).filter(u => u.startsWith("http"));

        if (imageUrls.length > 0) {
          const slug = this._nameFromUrl(url);
          const imageDir = path.join(outputDir, "images", slug);
          this.logger.log(`  Downloading ${imageUrls.length} images...`);
          pageResult.images = await this.imageDownloader.downloadAll(imageUrls, imageDir, slug);
        }
      }

      // Screenshot
      if (this.screenshotMode && page) {
        const slug = this._nameFromUrl(url);
        const result = await this.screenshotOutput.write(page, outputDir, slug, {
          mode: this.screenshotMode,
          format: this.screenshotFormat,
          quality: this.screenshotQuality
        });
        pageResult.screenshot = result;
        this._emitProgress("screenshot:done", { url, data: result });
        this.logger.log(`  Screenshot: ${path.basename(result.filepath)} (${this.outputManager.formatSize(result.size)})`);
      }

      // Screenshot as base64
      if (this.screenshotBase64 && page) {
        if (!this.screenshotOutput) {
          const ScreenshotOutput = require("../outputs/screenshot-output");
          this.screenshotOutput = new ScreenshotOutput(this.outputManager);
        }
        const b64Result = await this.screenshotOutput.toBase64(page, {
          mode: this.screenshotMode || "fullpage",
          format: this.screenshotFormat,
          quality: this.screenshotQuality
        });
        pageResult.screenshotBase64 = b64Result.base64;
        this.logger.log(`  Screenshot (base64): ${(b64Result.size / 1024).toFixed(1)}KB`);
      }

      // PDF
      if (this.pdfEnabled && page) {
        const slug = this._nameFromUrl(url);
        const result = await this.pdfOutput.write(page, outputDir, `${slug}.pdf`);
        pageResult.pdf = result;
        this._emitProgress("pdf:done", { url, data: result });
        this.logger.log(`  PDF: ${path.basename(result.filepath)} (${this.outputManager.formatSize(result.size)})`);
      }

      return pageResult;
    } finally {
      if (page && this.httpClient.closePage) {
        await this.httpClient.closePage(page);
      }
    }
  }

  _emitProgress(phase, data = {}) {
    if (this.onProgress) {
      try { this.onProgress({ phase, ...data }); } catch { /* ignore callback errors */ }
    }
  }

  _resolveUrls(input) {
    if (Array.isArray(input)) return input;

    // Check if it's a file path
    if (fs.existsSync(input) && !input.startsWith("http")) {
      const content = fs.readFileSync(input, "utf-8");
      return content.split("\n").map(l => l.trim()).filter(l => l && l.startsWith("http"));
    }

    return [input];
  }

  _nameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, "").replace(/\./g, "-");
    } catch {
      return "scrape";
    }
  }

  _flattenForCsv(result) {
    const flat = {};

    if (result.extracted) {
      for (const [key, value] of Object.entries(result.extracted)) {
        flat[`extracted_${key}`] = Array.isArray(value) ? value.join("|") : value;
      }
    }

    if (result.autoparse) {
      for (const [key, value] of Object.entries(result.autoparse)) {
        if (Array.isArray(value)) {
          flat[`auto_${key}`] = value.map(v =>
            typeof v === "object" ? JSON.stringify(v) : String(v)
          ).join("|");
        } else if (typeof value === "object") {
          for (const [k, v] of Object.entries(value)) {
            flat[`auto_${key}_${k}`] = Array.isArray(v) ? v.join("|") : v;
          }
        }
      }
    }

    return flat;
  }
}

module.exports = GenericScraper;
