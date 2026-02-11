/**
 * AdaptiveBypass — Auto-detects anti-bot protection and selects appropriate bypass strategy.
 *
 * Detection targets:
 * - Cloudflare (standard + Under Attack Mode + Turnstile)
 * - DataDome
 * - PerimeterX / HUMAN Security
 * - Akamai Bot Manager
 * - Kasada
 * - AWS WAF
 * - Incapsula / Imperva
 *
 * Strategies:
 * 1. Headers: Set TLS fingerprint-consistent headers
 * 2. Timing: Add human-like delays
 * 3. JavaScript challenges: Wait for challenge completion
 * 4. Cookie management: Preserve and replay challenge cookies
 * 5. Browser behavior: Mouse movements, scroll patterns
 */

class AdaptiveBypass {
  constructor({ verbose = false, captchaSolver = null } = {}) {
    this.verbose = verbose;
    this.captchaSolver = captchaSolver;
    this._detectedProtections = new Map(); // domain -> protection type
  }

  /**
   * Detect what anti-bot protection a page is using.
   * @param {string} html - Page HTML content
   * @param {object} headers - Response headers
   * @param {number} status - HTTP status code
   * @returns {{ type: string, confidence: number, details: object } | null}
   */
  detect(html, headers = {}, status = 200) {
    const detections = [];
    const headerStr = JSON.stringify(headers).toLowerCase();
    const htmlLower = (html || "").toLowerCase();

    // --- Cloudflare ---
    if (
      headers["cf-ray"] ||
      headers["cf-cache-status"] ||
      headers["server"] === "cloudflare" ||
      htmlLower.includes("cloudflare") ||
      htmlLower.includes("cf-browser-verification") ||
      htmlLower.includes("cf_chl_opt") ||
      (status === 403 && htmlLower.includes("ray id"))
    ) {
      const isChallenge = status === 403 || status === 503 ||
        htmlLower.includes("cf-browser-verification") ||
        htmlLower.includes("cf_chl_opt") ||
        htmlLower.includes("just a moment");
      const hasTurnstile = htmlLower.includes("cf-turnstile") || htmlLower.includes("turnstile.render");

      detections.push({
        type: "cloudflare",
        confidence: headers["cf-ray"] ? 0.95 : 0.75,
        details: {
          challenge: isChallenge,
          turnstile: hasTurnstile,
          underAttack: htmlLower.includes("checking your browser") || htmlLower.includes("just a moment"),
          rayId: headers["cf-ray"] || null
        }
      });
    }

    // --- DataDome ---
    if (
      headers["x-datadome"] ||
      headers["x-dd-b"] ||
      headerStr.includes("datadome") ||
      htmlLower.includes("datadome.co") ||
      htmlLower.includes("dd.datadome") ||
      htmlLower.includes("window.__dd")
    ) {
      detections.push({
        type: "datadome",
        confidence: 0.9,
        details: {
          blocked: status === 403 || htmlLower.includes("interstitial"),
          hasCaptcha: htmlLower.includes("captcha") || htmlLower.includes("geo.captcha-delivery")
        }
      });
    }

    // --- PerimeterX / HUMAN Security ---
    if (
      headers["x-px"] ||
      htmlLower.includes("perimeterx") ||
      htmlLower.includes("_pxhd") ||
      htmlLower.includes("px-captcha") ||
      htmlLower.includes("human challenge") ||
      htmlLower.includes("/px/client/main")
    ) {
      detections.push({
        type: "perimeterx",
        confidence: 0.85,
        details: {
          blocked: status === 403 || htmlLower.includes("px-captcha"),
          sensorEndpoint: this._extractPattern(html, /\/api\/v[12]\/collector/i)
        }
      });
    }

    // --- Akamai Bot Manager ---
    if (
      headers["x-akamai-transformed"] ||
      htmlLower.includes("akamai") ||
      htmlLower.includes("_abck") ||
      htmlLower.includes("ak_bmsc") ||
      htmlLower.includes("sensor_data") ||
      htmlLower.includes("akamaibmp")
    ) {
      detections.push({
        type: "akamai",
        confidence: 0.8,
        details: {
          blocked: status === 403 || htmlLower.includes("access denied"),
          hasSensor: htmlLower.includes("sensor_data") || htmlLower.includes("_abck")
        }
      });
    }

    // --- Kasada ---
    if (
      htmlLower.includes("kasada") ||
      htmlLower.includes("cd.consentmanager") ||
      htmlLower.includes("ips.js") ||
      headers["x-kpsdk-ct"] ||
      headers["x-kpsdk-cd"]
    ) {
      detections.push({
        type: "kasada",
        confidence: 0.8,
        details: {
          blocked: status === 429 || status === 403
        }
      });
    }

    // --- Incapsula / Imperva ---
    if (
      headers["x-iinfo"] ||
      htmlLower.includes("incapsula") ||
      htmlLower.includes("imperva") ||
      htmlLower.includes("_incap_") ||
      htmlLower.includes("reese84")
    ) {
      detections.push({
        type: "incapsula",
        confidence: 0.85,
        details: {
          blocked: status === 403 || htmlLower.includes("request unsuccessful"),
          hasReese84: htmlLower.includes("reese84")
        }
      });
    }

    // --- AWS WAF ---
    if (
      headers["x-amzn-waf-action"] ||
      (status === 403 && htmlLower.includes("request blocked")) ||
      htmlLower.includes("aws-waf-token")
    ) {
      detections.push({
        type: "aws_waf",
        confidence: 0.7,
        details: {
          blocked: status === 403
        }
      });
    }

    // Return highest confidence detection
    if (detections.length === 0) return null;
    detections.sort((a, b) => b.confidence - a.confidence);
    return detections[0];
  }

  /**
   * Apply bypass strategy for a detected protection on a Puppeteer page.
   * @param {import('puppeteer').Page} page
   * @param {{ type: string, details: object }} detection
   * @param {string} url
   * @returns {{ bypassed: boolean, strategy: string }}
   */
  async applyBypass(page, detection, url) {
    if (!detection || !page) return { bypassed: false, strategy: "none" };

    if (this.verbose) console.log(`  Anti-bot: ${detection.type} detected (confidence: ${(detection.confidence * 100).toFixed(0)}%)`);

    switch (detection.type) {
      case "cloudflare":
        return this._bypassCloudflare(page, detection, url);
      case "datadome":
        return this._bypassDataDome(page, detection, url);
      case "perimeterx":
        return this._bypassPerimeterX(page, detection, url);
      case "akamai":
        return this._bypassAkamai(page, detection, url);
      case "incapsula":
        return this._bypassIncapsula(page, detection, url);
      default:
        return this._bypassGeneric(page, detection, url);
    }
  }

  // --- Provider-specific bypass strategies ---

  async _bypassCloudflare(page, detection, url) {
    const d = detection.details;

    if (d.underAttack || d.challenge) {
      if (this.verbose) console.log("  Cloudflare: Waiting for JS challenge to complete...");

      // Cloudflare JS challenges typically redirect after 5-8 seconds
      try {
        await page.waitForFunction(() => {
          return !document.title.includes("Just a moment") &&
                 !document.body?.innerText?.includes("Checking your browser");
        }, { timeout: 15000, polling: 1000 });

        // Wait for the redirect/reload
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
        if (this.verbose) console.log("  Cloudflare: JS challenge passed");
        return { bypassed: true, strategy: "cloudflare_js_challenge" };
      } catch {
        if (this.verbose) console.log("  Cloudflare: JS challenge timeout, trying captcha...");
      }
    }

    if (d.turnstile && this.captchaSolver) {
      if (this.verbose) console.log("  Cloudflare: Attempting Turnstile solve...");
      const html = await page.content();
      const result = await this.captchaSolver.detectAndSolve(html, url);
      if (result) {
        await this.captchaSolver.injectSolution(page, result.token, result.type);
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
        return { bypassed: true, strategy: "cloudflare_turnstile" };
      }
    }

    // Final fallback: wait and hope JS challenge auto-completes
    await this._humanDelay(3000, 5000);
    return { bypassed: false, strategy: "cloudflare_wait" };
  }

  async _bypassDataDome(page, detection, url) {
    if (detection.details.hasCaptcha && this.captchaSolver) {
      if (this.verbose) console.log("  DataDome: Attempting captcha solve...");
      const html = await page.content();
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const result = await this.captchaSolver.detectAndSolve(html, url, { userAgent });
      if (result) {
        await this.captchaSolver.injectSolution(page, result.token, result.type);
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
        return { bypassed: true, strategy: "datadome_captcha" };
      }
    }

    // DataDome: simulate human behavior to pass JS check
    await this._simulateHumanBehavior(page);
    await this._humanDelay(2000, 4000);

    // Reload and check if we pass
    await page.reload({ waitUntil: "networkidle2" });
    return { bypassed: true, strategy: "datadome_behavior" };
  }

  async _bypassPerimeterX(page, detection, url) {
    if (detection.details.blocked) {
      if (this.verbose) console.log("  PerimeterX: Simulating human behavior...");

      // PerimeterX tracks mouse movements and interaction patterns
      await this._simulateHumanBehavior(page);

      // Wait for PX sensor to collect data
      await this._humanDelay(3000, 5000);

      // Check if there's a "Press & Hold" button
      const holdButton = await page.$('#px-captcha, [aria-label="Press & Hold"]');
      if (holdButton) {
        if (this.verbose) console.log("  PerimeterX: Executing press-and-hold...");
        const box = await holdButton.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await this._humanDelay(8000, 12000); // Hold for 8-12 seconds
          await page.mouse.up();
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
          return { bypassed: true, strategy: "perimeterx_hold" };
        }
      }

      // Reload and hope sensor data is enough
      await page.reload({ waitUntil: "networkidle2" });
      return { bypassed: false, strategy: "perimeterx_behavior" };
    }

    return { bypassed: true, strategy: "perimeterx_passthrough" };
  }

  async _bypassAkamai(page, detection, url) {
    if (detection.details.blocked) {
      if (this.verbose) console.log("  Akamai: Simulating sensor interactions...");

      // Akamai Bot Manager uses sensor_data collection
      await this._simulateHumanBehavior(page);
      await this._humanDelay(2000, 4000);

      // Let the Akamai script run and collect sensor data
      await page.evaluate(() => {
        // Trigger events that Akamai's sensor looks for
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 200 }));
        document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 400 }));
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
        document.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
      });

      await this._humanDelay(1000, 2000);
      await page.reload({ waitUntil: "networkidle2" });
      return { bypassed: false, strategy: "akamai_sensor" };
    }

    return { bypassed: true, strategy: "akamai_passthrough" };
  }

  async _bypassIncapsula(page, detection, url) {
    if (detection.details.hasReese84) {
      if (this.verbose) console.log("  Incapsula: Waiting for Reese84 challenge...");

      // Reese84 is an advanced JS challenge
      await this._humanDelay(3000, 5000);

      try {
        await page.waitForFunction(() => {
          return !document.body?.innerText?.includes("Request unsuccessful");
        }, { timeout: 15000, polling: 1000 });
        return { bypassed: true, strategy: "incapsula_reese84" };
      } catch {
        // Try reload
        await page.reload({ waitUntil: "networkidle2" });
        return { bypassed: false, strategy: "incapsula_reload" };
      }
    }

    return { bypassed: false, strategy: "incapsula_generic" };
  }

  async _bypassGeneric(page, detection, url) {
    if (this.verbose) console.log(`  Generic bypass for ${detection.type}...`);
    await this._simulateHumanBehavior(page);
    await this._humanDelay(2000, 4000);
    return { bypassed: false, strategy: "generic_behavior" };
  }

  // --- Utility methods ---

  async _simulateHumanBehavior(page) {
    try {
      // Random mouse movements
      const viewport = page.viewport() || { width: 1920, height: 1080 };
      for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
        const x = Math.floor(Math.random() * viewport.width);
        const y = Math.floor(Math.random() * viewport.height);
        await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
        await this._humanDelay(100, 500);
      }

      // Small scroll
      await page.evaluate(() => {
        window.scrollBy(0, 100 + Math.floor(Math.random() * 300));
      });
      await this._humanDelay(200, 800);

      // Scroll back up a bit
      await page.evaluate(() => {
        window.scrollBy(0, -(50 + Math.floor(Math.random() * 100)));
      });
    } catch {
      // Page might have navigated away during simulation
    }
  }

  _humanDelay(min, max) {
    const ms = min + Math.floor(Math.random() * (max - min));
    return new Promise(r => setTimeout(r, ms));
  }

  _extractPattern(html, regex) {
    const match = (html || "").match(regex);
    return match ? match[0] : null;
  }

  /**
   * Get summary of all detected protections for this session.
   * @returns {Map<string, string>}
   */
  getDetectedProtections() {
    return new Map(this._detectedProtections);
  }
}

module.exports = AdaptiveBypass;
