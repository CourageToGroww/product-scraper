#!/usr/bin/env node
const { Command } = require("commander");
const GenericScraper = require("./lib/scrapers/generic-scraper");
const Page365Scraper = require("./lib/scrapers/page365-scraper");

const program = new Command();

program
  .name("scrapekit")
  .description("prodactive-scrapekit: A ZenRows-inspired web scraping toolkit")
  .version("1.0.0");

// --- Generic scrape command ---
program
  .command("scrape")
  .description("Scrape any URL with CSS extraction, auto-parsing, and multiple output formats")
  .argument("<url>", "URL to scrape (or path to file with URLs)")
  .option("--extract <json>", "CSS selector schema as JSON string")
  .option("--auto-parse <filters>", "Auto-extract data types (comma-separated: emails,phones,links,images,headings,tables,metadata,videos,audios,hashtags,favicons,menus,all)")
  .option("--output <formats>", "Output formats (comma-separated: json,csv,markdown,text,html)", "json")
  .option("--name <name>", "Output folder name")
  .option("--headers <json>", "Custom HTTP headers as JSON string")
  .option("--cookie <string>", "Cookie header value")
  .option("--proxy <url>", "Proxy URL (http://user:pass@host:port)")
  .option("--proxy-file <path>", "Path to JSON file with proxy list")
  .option("--rotate-ua", "Enable User-Agent rotation", false)
  .option("--concurrency <n>", "Max concurrent requests", parseInt, 3)
  .option("--delay <ms>", "Delay between requests in ms", parseInt, 200)
  .option("--retry <n>", "Max retries per request", parseInt, 3)
  .option("--timeout <ms>", "Request timeout in ms", parseInt, 30000)
  .option("--download-images", "Download all images found", false)
  .option("--js-render", "Enable headless browser for JS rendering", false)
  .option("--wait-for <selector>", "Wait for CSS selector to appear before extracting")
  .option("--wait <ms>", "Fixed delay (ms) after page load", parseInt)
  .option("--block-resources <types>", "Block resource types (comma-separated: images,fonts,css,media)")
  .option("--screenshot <mode>", "Take screenshot: fullpage, abovefold, or CSS selector")
  .option("--screenshot-format <fmt>", "Screenshot format: png or jpeg", "png")
  .option("--screenshot-quality <n>", "JPEG quality 1-100", parseInt, 80)
  .option("--pdf", "Generate PDF of each page", false)
  .option("--captcha-key <key>", "2Captcha API key (or set CAPTCHA_API_KEY env var)")
  .option("--session", "Reuse same proxy/cookies across requests", false)
  .option("--session-file <path>", "Path to session file for persistence across runs")
  .option("--stealth", "Maximum anti-detection mode", false)
  .option("--js-instructions <json>", "Execute page actions (click, fill, scroll, wait, evaluate)")
  .option("--json-response [patterns]", "Capture XHR/Fetch network requests (comma-separated URL patterns)")
  .option("--allowed-status <codes>", "Don't error on these HTTP status codes (comma-separated)")
  .option("--method <method>", "HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD", "GET")
  .option("--request-body <data>", "Request body for POST/PUT/PATCH (JSON string or raw data)")
  .option("--device <type>", "Device emulation: mobile, tablet, desktop, or Puppeteer device name")
  .option("--window-width <px>", "Browser viewport width in pixels", parseInt)
  .option("--window-height <px>", "Browser viewport height in pixels", parseInt)
  .option("--wait-for-event <event>", "Wait for page event: load, domcontentloaded, networkidle0, networkidle2, requestsfinished")
  .option("--response-type <type>", "Convert response: html (default), markdown, plaintext")
  .option("--screenshot-base64", "Return screenshot as base64 data URI in JSON output", false)
  .option("--proxy-country <code>", "Geotarget via proxy country (ISO 3166-1 alpha-2, e.g. us, gb, de)")
  .option("--anti-bot", "Enable adaptive anti-bot detection and bypass", false)
  .option("--verbose", "Enable detailed logging", false)
  .action(async (url, opts) => {
    try {
      const headers = opts.headers ? JSON.parse(opts.headers) : {};
      const blockResources = opts.blockResources
        ? opts.blockResources.split(",").map(s => s.trim())
        : [];

      if (opts.screenshotFormat && !["png", "jpeg"].includes(opts.screenshotFormat)) {
        console.error("Error: --screenshot-format must be \"png\" or \"jpeg\"");
        process.exit(1);
      }
      if (opts.screenshotQuality && (opts.screenshotQuality < 1 || opts.screenshotQuality > 100)) {
        console.error("Error: --screenshot-quality must be between 1 and 100");
        process.exit(1);
      }
      if (opts.sessionFile && !opts.session && !opts.stealth) {
        console.error("Error: --session-file requires --session or --stealth");
        process.exit(1);
      }

      let jsInstructions = null;
      if (opts.jsInstructions) {
        try {
          jsInstructions = JSON.parse(opts.jsInstructions);
          if (!Array.isArray(jsInstructions)) {
            console.error("Error: --js-instructions must be a JSON array");
            process.exit(1);
          }
        } catch (e) {
          console.error(`Error: --js-instructions invalid JSON: ${e.message}`);
          process.exit(1);
        }
      }

      let jsonResponse = null;
      if (opts.jsonResponse !== undefined && opts.jsonResponse !== false) {
        jsonResponse = typeof opts.jsonResponse === "string" && opts.jsonResponse.length > 0
          ? opts.jsonResponse.split(",").map(s => s.trim())
          : [];
      }

      // Validate HTTP method
      const validMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
      const method = (opts.method || "GET").toUpperCase();
      if (!validMethods.includes(method)) {
        console.error(`Error: --method must be one of: ${validMethods.join(", ")}`);
        process.exit(1);
      }

      // Parse request body
      let requestBody = null;
      if (opts.requestBody) {
        try {
          requestBody = JSON.parse(opts.requestBody);
        } catch {
          requestBody = opts.requestBody; // Use as raw string
        }
      }

      // Validate wait-for-event
      const validEvents = ["load", "domcontentloaded", "networkidle0", "networkidle2", "requestsfinished"];
      if (opts.waitForEvent && !validEvents.includes(opts.waitForEvent)) {
        console.error(`Error: --wait-for-event must be one of: ${validEvents.join(", ")}`);
        process.exit(1);
      }

      // Validate response-type
      const validResponseTypes = ["html", "markdown", "md", "plaintext", "text"];
      if (opts.responseType && !validResponseTypes.includes(opts.responseType)) {
        console.error(`Error: --response-type must be one of: ${validResponseTypes.join(", ")}`);
        process.exit(1);
      }

      // Validate device
      const validDevicePresets = ["mobile", "tablet", "desktop"];
      if (opts.device && !validDevicePresets.includes(opts.device.toLowerCase())) {
        // Allow any string (Puppeteer device names) — just warn if not a preset
        if (opts.verbose) {
          console.log(`Note: "${opts.device}" is not a preset (mobile/tablet/desktop), will attempt Puppeteer device lookup`);
        }
      }

      const scraper = new GenericScraper({
        timeout: opts.timeout,
        retry: opts.retry,
        headers,
        cookie: opts.cookie,
        proxy: opts.proxy,
        proxyFile: opts.proxyFile,
        rotateUa: opts.rotateUa,
        concurrency: opts.concurrency,
        delay: opts.delay,
        verbose: opts.verbose,
        jsRender: opts.jsRender,
        waitFor: opts.waitFor,
        waitForEvent: opts.waitForEvent,
        wait: opts.wait,
        blockResources,
        screenshot: opts.screenshot,
        screenshotFormat: opts.screenshotFormat,
        screenshotQuality: opts.screenshotQuality,
        screenshotBase64: opts.screenshotBase64,
        pdf: opts.pdf,
        captchaKey: opts.captchaKey,
        session: opts.session,
        sessionFile: opts.sessionFile,
        stealth: opts.stealth,
        jsInstructions,
        jsonResponse,
        allowedStatus: opts.allowedStatus,
        method,
        requestBody,
        device: opts.device,
        windowWidth: opts.windowWidth,
        windowHeight: opts.windowHeight,
        responseType: opts.responseType,
        proxyCountry: opts.proxyCountry,
        antiBot: opts.antiBot
      });

      await scraper.scrape(url, {
        name: opts.name,
        extract: opts.extract,
        autoParse: opts.autoParse,
        output: opts.output,
        downloadImages: opts.downloadImages
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (opts.verbose) console.error(err.stack);
      process.exit(1);
    }
  });

// --- Page365 store export command ---
program
  .command("page365")
  .description("Export all products from a Page365 store (categories, variants, reviews, images)")
  .argument("<store-url>", "Page365 store URL (e.g. https://dearmaiah.com)")
  .option("--name <name>", "Output folder name")
  .option("--no-images", "Skip image downloads")
  .option("--output <formats>", "Output formats", "json,csv")
  .action(async (storeUrl, opts) => {
    try {
      const name = opts.name || new URL(storeUrl).hostname.replace(/^www\./, "").replace(/\./g, "-");

      const scraper = new Page365Scraper({
        baseUrl: storeUrl,
        outputName: name,
        downloadImages: opts.images !== false
      });

      await scraper.scrapeAll();
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- TUI command ---
program
  .command("tui")
  .description("Launch interactive terminal UI")
  .action(async () => {
    const { execFileSync } = require("child_process");
    const path = require("path");
    try {
      execFileSync("node", [path.join(__dirname, "tui", "index.js")], {
        stdio: "inherit",
        cwd: process.cwd()
      });
    } catch {
      // TUI exited (normal on Ctrl+C)
    }
  });

program.parse();
