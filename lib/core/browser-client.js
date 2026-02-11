const axios = require("axios");

const RESOURCE_TYPE_MAP = {
  images: "image",
  fonts: "font",
  css: "stylesheet",
  media: "media",
  image: "image",
  font: "font",
  stylesheet: "stylesheet",
  script: "script"
};

class BrowserClient {
  constructor({
    timeout = 30000,
    headers = {},
    cookies = null,
    proxy = null,
    userAgentRotator = null,
    proxyRotator = null,
    sessionManager = null,
    blockResources = [],
    waitForSelector = null,
    waitForEvent = null,
    waitMs = 0,
    jsInstructions = null,
    jsonResponse = null,
    allowedStatus = null,
    device = null,
    windowWidth = null,
    windowHeight = null,
    method = "GET",
    requestBody = null,
    verbose = false
  } = {}) {
    this.timeout = timeout;
    this.defaultHeaders = { ...headers };
    this.cookies = cookies;
    this.staticProxy = proxy;
    this.userAgentRotator = userAgentRotator;
    this.proxyRotator = proxyRotator;
    this.sessionManager = sessionManager;
    this.blockResources = (blockResources || []).map(r => RESOURCE_TYPE_MAP[r] || r);
    this.waitForSelector = waitForSelector;
    this.waitForEvent = waitForEvent;
    this.waitMs = waitMs;
    this.jsInstructions = jsInstructions;
    this.jsonResponse = jsonResponse;
    this.allowedStatus = allowedStatus;
    this.device = device;
    this.windowWidth = windowWidth;
    this.windowHeight = windowHeight;
    this.method = (method || "GET").toUpperCase();
    this.requestBody = requestBody;
    this.verbose = verbose;
    this.browser = null;

    this._cleanupHandler = () => {
      if (this.browser) {
        this.browser.close().catch(() => {});
      }
    };
  }

  async launch() {
    if (this.browser) return;

    const puppeteer = require("puppeteer-extra");
    const StealthPlugin = require("puppeteer-extra-plugin-stealth");
    puppeteer.use(StealthPlugin());

    const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
    const proxy = this.sessionManager
      ? this.sessionManager.getProxy()
      : (this.proxyRotator ? this.proxyRotator.next() : this.staticProxy);
    if (proxy) {
      launchArgs.push(`--proxy-server=${proxy}`);
      if (this.verbose) console.log(`  Browser proxy: ${proxy}`);
    }

    if (this.verbose) console.log("  Launching headless browser...");

    this.browser = await puppeteer.launch({
      headless: "new",
      args: launchArgs,
      timeout: this.timeout
    });

    process.on("SIGINT", this._cleanupHandler);
    process.on("SIGTERM", this._cleanupHandler);

    if (this.verbose) console.log("  Browser launched");
  }

  async fetch(url, { headers: extraHeaders = {} } = {}) {
    const start = Date.now();
    await this.launch();

    if (this.verbose) console.log(`  GET (browser) ${url}`);

    const page = await this.browser.newPage();
    try {
      // Device emulation
      if (this.device) {
        const puppeteer = require("puppeteer-core");
        const devices = puppeteer.KnownDevices || require("puppeteer-core/lib/cjs/puppeteer/common/Device.js").knownDevices;
        const DEVICE_PRESETS = {
          mobile: { viewport: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" },
          tablet: { viewport: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1" },
          desktop: { viewport: { width: 1920, height: 1080, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, userAgent: null }
        };
        const preset = DEVICE_PRESETS[this.device.toLowerCase()];
        if (preset) {
          await page.setViewport(preset.viewport);
          if (preset.userAgent) await page.setUserAgent(preset.userAgent);
        } else if (devices && devices[this.device]) {
          await page.emulate(devices[this.device]);
        } else {
          // Fall back to desktop with custom device name as UA hint
          await page.setViewport({ width: 1920, height: 1080 });
        }
      } else {
        const vw = this.windowWidth || 1920;
        const vh = this.windowHeight || 1080;
        await page.setViewport({ width: vw, height: vh });
      }

      // Set user agent
      if (this.sessionManager) {
        await page.setUserAgent(this.sessionManager.getUserAgent());
      } else if (this.userAgentRotator) {
        await page.setUserAgent(this.userAgentRotator.get());
      }

      // Set cookies from session manager
      if (this.sessionManager) {
        const browserCookies = this.sessionManager.getCookiesForBrowser(url);
        if (browserCookies.length > 0) {
          await page.setCookie(...browserCookies);
        }
      }

      // Build extra headers
      const allHeaders = { ...this.defaultHeaders, ...extraHeaders };
      if (!this.sessionManager && this.cookies) {
        allHeaders["Cookie"] = this.cookies;
      }
      delete allHeaders["User-Agent"];
      if (Object.keys(allHeaders).length > 0) {
        await page.setExtraHTTPHeaders(allHeaders);
      }

      // Request interception for resource blocking and HTTP method override
      const needsInterception = this.blockResources.length > 0 || this.method !== "GET";
      if (needsInterception) {
        await page.setRequestInterception(true);
        let blocked = 0;
        let methodOverridden = false;
        page.on("request", (req) => {
          if (this.blockResources.includes(req.resourceType())) {
            blocked++;
            req.abort();
          } else if (!methodOverridden && req.isNavigationRequest() && this.method !== "GET") {
            // Override method for the first navigation request
            methodOverridden = true;
            const overrides = { method: this.method };
            if (this.requestBody) {
              overrides.postData = typeof this.requestBody === "string"
                ? this.requestBody
                : JSON.stringify(this.requestBody);
            }
            req.continue(overrides);
          } else {
            req.continue();
          }
        });
        if (this.verbose) {
          page.on("close", () => {
            if (blocked > 0) console.log(`  Blocked ${blocked} resource(s)`);
          });
        }
      }

      // Attach network interceptor before navigation
      let interceptor = null;
      if (this.jsonResponse) {
        const NetworkInterceptor = require("./network-interceptor");
        const patterns = Array.isArray(this.jsonResponse) ? this.jsonResponse : [];
        interceptor = new NetworkInterceptor({ patterns, verbose: this.verbose });
        interceptor.attach(page);
      }

      // Navigate — use specified wait event or default to networkidle2
      const WAIT_EVENTS = ["load", "domcontentloaded", "networkidle0", "networkidle2"];
      const waitUntil = this.waitForEvent && WAIT_EVENTS.includes(this.waitForEvent)
        ? this.waitForEvent
        : "networkidle2";
      const response = await page.goto(url, {
        waitUntil,
        timeout: this.timeout
      });

      // Check status code against allowed list
      const respStatus = response ? response.status() : 0;
      if (respStatus >= 400 && this.allowedStatus && !this.allowedStatus.includes(respStatus)) {
        throw new Error(`HTTP ${respStatus} (not in allowed status codes)`);
      }

      // Wait for CSS selector
      if (this.waitForSelector) {
        if (this.verbose) console.log(`  Waiting for selector: ${this.waitForSelector}`);
        await page.waitForSelector(this.waitForSelector, { timeout: this.timeout });
      }

      // Wait for network idle after navigation (when explicitly requested and not already used in goto)
      if (this.waitForEvent === "requestsfinished" || (this.waitForEvent === "networkidle0" && waitUntil !== "networkidle0")) {
        if (this.verbose) console.log(`  Waiting for network idle...`);
        await page.waitForNetworkIdle({ idleTime: 500, timeout: this.timeout });
      }

      // Fixed delay
      if (this.waitMs > 0) {
        if (this.verbose) console.log(`  Waiting ${this.waitMs}ms...`);
        await new Promise(r => setTimeout(r, this.waitMs));
      }

      // Execute JS instructions
      if (this.jsInstructions && this.jsInstructions.length > 0) {
        const JsInstructor = require("./js-instructor");
        const instructor = new JsInstructor({ verbose: this.verbose });
        await instructor.execute(page, this.jsInstructions);
      }

      // Capture cookies back into session manager
      if (this.sessionManager) {
        const pageCookies = await page.cookies();
        for (const c of pageCookies) {
          this.sessionManager.setCookie(url, c.name, c.value, {
            domain: c.domain,
            path: c.path,
            expires: c.expires > 0 ? c.expires * 1000 : null,
            secure: c.secure,
            httpOnly: c.httpOnly
          });
        }
        this.sessionManager.trackRequest();
      }

      // Collect intercepted network responses
      let networkRequests = null;
      if (interceptor) {
        interceptor.detach(page);
        networkRequests = interceptor.getResponses();
        if (this.verbose) console.log(`  Captured ${interceptor.count} network request(s)`);
      }

      const html = await page.content();
      const status = response ? response.status() : 0;
      const responseHeaders = response ? response.headers() : {};
      const finalUrl = page.url();

      return {
        status,
        originalStatus: status,
        headers: responseHeaders,
        html,
        data: html,
        url: finalUrl,
        timing: Date.now() - start,
        networkRequests,
        _page: page
      };
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  async solveCaptchaIfPresent(page, url, captchaSolver) {
    if (!captchaSolver || !page || page.isClosed()) return null;

    const html = await page.content();
    const result = await captchaSolver.detectAndSolve(html, url);
    if (!result) return null;

    if (this.verbose) console.log(`  Solving ${result.type} captcha...`);
    await captchaSolver.injectSolution(page, result.token, result.type);

    // Wait for possible navigation after captcha solve
    try {
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 });
    } catch {
      // No navigation happened, that's ok
    }

    return result;
  }

  async closePage(page) {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }

  async close() {
    process.removeListener("SIGINT", this._cleanupHandler);
    process.removeListener("SIGTERM", this._cleanupHandler);
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      if (this.verbose) console.log("  Browser closed");
    }
  }

  async download(url, { headers = {} } = {}) {
    const config = {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...this.defaultHeaders,
        ...headers
      },
      timeout: this.timeout
    };
    const resp = await axios.get(url, config);
    return {
      data: resp.data,
      contentType: resp.headers["content-type"] || "",
      size: resp.data.length
    };
  }
}

module.exports = BrowserClient;
