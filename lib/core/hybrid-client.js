const HttpClient = require("./http-client");
const BrowserClient = require("./browser-client");

class HybridClient {
  constructor(options = {}) {
    this.httpClient = new HttpClient(options);
    this.browserClient = new BrowserClient(options);
    this.verbose = options.verbose || false;
  }

  async fetch(url, fetchOpts = {}) {
    try {
      const result = await this.httpClient.fetch(url, fetchOpts);

      if (this._needsBrowser(result.html)) {
        if (this.verbose) {
          console.log("  SPA indicators detected, retrying with browser...");
        }
        return await this.browserClient.fetch(url, fetchOpts);
      }

      return result;
    } catch (err) {
      if (this.verbose) {
        console.log(`  HTTP failed (${err.message}), trying browser...`);
      }
      return await this.browserClient.fetch(url, fetchOpts);
    }
  }

  _needsBrowser(html) {
    if (!html || typeof html !== "string") return true;

    const lower = html.toLowerCase();

    // Almost empty body after stripping scripts
    const bodyMatch = lower.match(/<body[^>]*>([\s\S]*?)<\/body>/);
    if (bodyMatch) {
      const bodyText = bodyMatch[1]
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (bodyText.length < 100) return true;
    }

    // Empty SPA root containers
    const spaRoots = ['id="__next"', 'id="app"', 'id="root"', 'id="__nuxt"'];
    for (const root of spaRoots) {
      if (lower.includes(root)) {
        const escaped = root.replace(/"/g, '"');
        const regex = new RegExp(`${escaped}[^>]*>\\s*</`, "i");
        if (regex.test(html)) return true;
      }
    }

    // Noscript fallback messages
    const jsRequired = [
      "you need to enable javascript",
      "this app requires javascript",
      "please enable javascript",
      "javascript is required"
    ];
    for (const msg of jsRequired) {
      if (lower.includes(msg)) return true;
    }

    return false;
  }

  async download(url, opts = {}) {
    return this.httpClient.download(url, opts);
  }

  async solveCaptchaIfPresent(page, url, captchaSolver) {
    return this.browserClient.solveCaptchaIfPresent(page, url, captchaSolver);
  }

  async closePage(page) {
    await this.browserClient.closePage(page);
  }

  async close() {
    await this.browserClient.close();
  }
}

module.exports = HybridClient;
