const axios = require("axios");

const API_BASE = "https://2captcha.com";

class CaptchaSolver {
  constructor({ apiKey, pollInterval = 5000, timeout = 120000, verbose = false } = {}) {
    if (!apiKey) throw new Error("CaptchaSolver requires a 2Captcha API key");
    this._apiKey = apiKey;
    this.pollInterval = pollInterval;
    this.timeout = timeout;
    this.verbose = verbose;
    this._lastTaskId = null;
  }

  // --- Public methods ---

  async solveRecaptchaV2(siteKey, pageUrl) {
    this._validateParams(siteKey, pageUrl);
    const taskId = await this._submitTask({
      method: "userrecaptcha",
      googlekey: siteKey,
      pageurl: pageUrl
    });
    return this._pollResult(taskId);
  }

  async solveRecaptchaV3(siteKey, pageUrl, action = "verify", minScore = 0.3) {
    this._validateParams(siteKey, pageUrl);
    const taskId = await this._submitTask({
      method: "userrecaptcha",
      version: "v3",
      googlekey: siteKey,
      pageurl: pageUrl,
      action,
      min_score: minScore
    });
    return this._pollResult(taskId);
  }

  async solveHCaptcha(siteKey, pageUrl) {
    this._validateParams(siteKey, pageUrl);
    const taskId = await this._submitTask({
      method: "hcaptcha",
      sitekey: siteKey,
      pageurl: pageUrl
    });
    return this._pollResult(taskId);
  }

  async solveTurnstile(siteKey, pageUrl) {
    this._validateParams(siteKey, pageUrl);
    const taskId = await this._submitTask({
      method: "turnstile",
      sitekey: siteKey,
      pageurl: pageUrl
    });
    return this._pollResult(taskId);
  }

  async solveGeeTest(gt, challenge, pageUrl, apiServer = null) {
    if (!gt || !challenge) throw new Error("CaptchaSolver: gt and challenge are required for GeeTest");
    this._validateParams(gt, pageUrl);
    const params = {
      method: "geetest",
      gt,
      challenge,
      pageurl: pageUrl
    };
    if (apiServer) params.api_server = apiServer;
    const taskId = await this._submitTask(params);
    return this._pollResult(taskId);
  }

  async solveGeeTestV4(captchaId, pageUrl) {
    this._validateParams(captchaId, pageUrl);
    const taskId = await this._submitTask({
      method: "geetest_v4",
      captcha_id: captchaId,
      pageurl: pageUrl
    });
    return this._pollResult(taskId);
  }

  async solveDataDome(captchaUrl, pageUrl, userAgent, proxyUrl = null) {
    if (!captchaUrl) throw new Error("CaptchaSolver: captchaUrl is required for DataDome");
    this._validateParams(captchaUrl, pageUrl);
    const params = {
      method: "datadome",
      captcha_url: captchaUrl,
      pageurl: pageUrl,
      userAgent
    };
    if (proxyUrl) {
      params.proxy = proxyUrl;
      params.proxytype = "HTTP";
    }
    const taskId = await this._submitTask(params);
    return this._pollResult(taskId);
  }

  async detectAndSolve(html, pageUrl, extraContext = {}) {
    if (!html || typeof html !== "string") return null;

    // Check for Cloudflare Turnstile
    const turnstileMatch = html.match(/class=["']cf-turnstile["'][^>]*data-sitekey=["']([^"']+)["']/i)
      || html.match(/data-sitekey=["']([^"']+)["'][^>]*class=["']cf-turnstile["']/i)
      || html.match(/turnstile\.render\s*\([^)]*sitekey\s*:\s*["']([^"']+)["']/i);
    if (turnstileMatch) {
      if (this.verbose) console.log("  Detected Cloudflare Turnstile");
      const token = await this.solveTurnstile(turnstileMatch[1], pageUrl);
      return { type: "turnstile", token, taskId: this._lastTaskId };
    }

    // Check for GeeTest v4
    const geetestV4Match = html.match(/captcha_id\s*["':=]\s*["']([0-9a-f]{32})["']/i)
      || html.match(/initGeetest4\s*\(\s*\{[^}]*captcha_id\s*:\s*["']([^"']+)["']/i);
    if (geetestV4Match) {
      if (this.verbose) console.log("  Detected GeeTest v4");
      const token = await this.solveGeeTestV4(geetestV4Match[1], pageUrl);
      return { type: "geetest_v4", token, taskId: this._lastTaskId };
    }

    // Check for GeeTest v3
    const geetestV3Match = html.match(/initGeetest\s*\(\s*\{[^}]*gt\s*:\s*["']([^"']+)["'][^}]*challenge\s*:\s*["']([^"']+)["']/is);
    if (geetestV3Match) {
      if (this.verbose) console.log("  Detected GeeTest v3");
      const apiServerMatch = html.match(/api_server\s*:\s*["']([^"']+)["']/i);
      const token = await this.solveGeeTest(geetestV3Match[1], geetestV3Match[2], pageUrl, apiServerMatch?.[1]);
      return { type: "geetest_v3", token, taskId: this._lastTaskId };
    }

    // Check for DataDome
    const datadomeMatch = html.match(/datadome\.co\/captcha/i)
      || html.match(/dd\.\w+\.datadome/i)
      || html.match(/interstitial\.datadome/i);
    if (datadomeMatch) {
      if (this.verbose) console.log("  Detected DataDome captcha");
      // DataDome captcha URL is typically in an iframe src or redirect
      const iframeMatch = html.match(/src=["'](https?:\/\/[^"']*datadome[^"']*captcha[^"']*)["']/i);
      const captchaUrl = iframeMatch ? iframeMatch[1] : pageUrl;
      const userAgent = extraContext.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      const token = await this.solveDataDome(captchaUrl, pageUrl, userAgent, extraContext.proxy);
      return { type: "datadome", token, taskId: this._lastTaskId };
    }

    // Check for hCaptcha
    const hcaptchaMatch = html.match(/class=["']h-captcha["'][^>]*data-sitekey=["']([^"']+)["']/i);
    if (hcaptchaMatch) {
      if (this.verbose) console.log("  Detected hCaptcha");
      const token = await this.solveHCaptcha(hcaptchaMatch[1], pageUrl);
      return { type: "hcaptcha", token, taskId: this._lastTaskId };
    }

    // Check for reCAPTCHA v3 (look for grecaptcha.execute in scripts)
    const recaptchaV3Match = html.match(/grecaptcha\.execute\s*\(\s*["']([^"']+)["']/i);
    if (recaptchaV3Match) {
      if (this.verbose) console.log("  Detected reCAPTCHA v3");
      const actionMatch = html.match(/grecaptcha\.execute\s*\([^,]+,\s*\{\s*action\s*:\s*["']([^"']+)["']/i);
      const action = actionMatch ? actionMatch[1] : "verify";
      const token = await this.solveRecaptchaV3(recaptchaV3Match[1], pageUrl, action);
      return { type: "recaptcha_v3", token, taskId: this._lastTaskId };
    }

    // Check for reCAPTCHA v2
    const recaptchaV2Match = html.match(/class=["']g-recaptcha["'][^>]*data-sitekey=["']([^"']+)["']/i);
    if (!recaptchaV2Match) {
      const altMatch = html.match(/data-sitekey=["']([^"']+)["'][^>]*class=["']g-recaptcha["']/i);
      if (altMatch) {
        if (this.verbose) console.log("  Detected reCAPTCHA v2");
        const token = await this.solveRecaptchaV2(altMatch[1], pageUrl);
        return { type: "recaptcha_v2", token, taskId: this._lastTaskId };
      }
    } else {
      if (this.verbose) console.log("  Detected reCAPTCHA v2");
      const token = await this.solveRecaptchaV2(recaptchaV2Match[1], pageUrl);
      return { type: "recaptcha_v2", token, taskId: this._lastTaskId };
    }

    return null;
  }

  async injectSolution(page, token, type) {
    if (type === "recaptcha_v2" || type === "recaptcha_v3") {
      await page.evaluate((t) => {
        // Set the response textarea
        const textarea = document.querySelector("#g-recaptcha-response");
        if (textarea) {
          textarea.style.display = "block";
          textarea.value = t;
        }
        // Also set in any iframes or additional response fields
        document.querySelectorAll('[name="g-recaptcha-response"]').forEach(el => {
          el.value = t;
        });
        // Try to trigger the callback
        if (typeof window.___grecaptcha_cfg !== "undefined") {
          try {
            const clients = window.___grecaptcha_cfg.clients;
            for (const key in clients) {
              const client = clients[key];
              // Walk the client object to find callback functions
              const walk = (obj, depth = 0) => {
                if (depth > 5 || !obj) return;
                for (const k in obj) {
                  if (typeof obj[k] === "function" && k.length < 3) {
                    try { obj[k](t); } catch (e) { /* ignore */ }
                  } else if (typeof obj[k] === "object") {
                    walk(obj[k], depth + 1);
                  }
                }
              };
              walk(client);
            }
          } catch (e) { /* ignore */ }
        }
      }, token);
    } else if (type === "hcaptcha") {
      await page.evaluate((t) => {
        const textarea = document.querySelector('[name="h-captcha-response"]');
        if (textarea) textarea.value = t;
        const iframe = document.querySelector('textarea[name="g-recaptcha-response"]');
        if (iframe) iframe.value = t;
        if (window.hcaptcha) {
          try {
            const widgetId = document.querySelector(".h-captcha iframe")?.dataset?.hcaptchaWidgetId;
            if (widgetId !== undefined) {
              window.hcaptcha.execute(widgetId);
            }
          } catch (e) { /* ignore */ }
        }
      }, token);
    } else if (type === "turnstile") {
      await page.evaluate((t) => {
        // Turnstile response fields
        const fields = document.querySelectorAll('[name="cf-turnstile-response"], [name="turnstileToken"]');
        fields.forEach(f => { f.value = t; });
        // Try the turnstile callback
        if (window.turnstile) {
          try { window.turnstile.remove(); } catch (e) { /* ignore */ }
        }
        // Dispatch input events on response fields
        fields.forEach(f => {
          f.dispatchEvent(new Event("input", { bubbles: true }));
          f.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }, token);
    } else if (type === "geetest_v3" || type === "geetest_v4") {
      // GeeTest solutions are typically multi-part JSON objects
      // The token from 2Captcha is already the full solution
      await page.evaluate((t) => {
        try {
          const solution = typeof t === "string" ? JSON.parse(t) : t;
          // Try to set geetest result variables
          if (window.captchaObj) {
            window.captchaObj.getValidate = () => solution;
          }
        } catch (e) { /* ignore */ }
      }, token);
    } else if (type === "datadome") {
      // DataDome solution is a cookie value
      await page.evaluate((t) => {
        document.cookie = `datadome=${t}; path=/; domain=${window.location.hostname}`;
      }, token);
    }
  }

  async reportResult(taskId, correct) {
    const action = correct ? "reportgood" : "reportbad";
    try {
      await axios.get(`${API_BASE}/res.php`, {
        params: { key: this._apiKey, action, id: taskId, json: 1 },
        timeout: 10000
      });
    } catch (err) {
      if (this.verbose) console.log(`  Failed to report captcha result: ${err.message}`);
    }
  }

  // --- Private methods ---

  _validateParams(siteKey, pageUrl) {
    if (!siteKey || typeof siteKey !== "string") {
      throw new Error("CaptchaSolver: siteKey is required and must be a non-empty string");
    }
    if (!pageUrl || typeof pageUrl !== "string") {
      throw new Error("CaptchaSolver: pageUrl is required and must be a non-empty string");
    }
    try {
      new URL(pageUrl);
    } catch {
      throw new Error(`CaptchaSolver: invalid pageUrl "${pageUrl}"`);
    }
  }

  async _submitTask(params) {
    const resp = await axios.post(`${API_BASE}/in.php`, null, {
      params: { key: this._apiKey, json: 1, ...params },
      timeout: 30000
    });

    const data = resp.data;
    if (data.status !== 1) {
      const code = data.request || "UNKNOWN";
      if (code === "ERROR_ZERO_BALANCE") {
        throw new Error("2Captcha: zero balance — add funds at https://2captcha.com");
      }
      if (code === "ERROR_WRONG_USER_KEY" || code === "ERROR_KEY_DOES_NOT_EXIST") {
        throw new Error("2Captcha: invalid API key");
      }
      throw new Error(`2Captcha submission error: ${code}`);
    }

    this._lastTaskId = data.request;
    if (this.verbose) console.log(`  Captcha task submitted: ${this._lastTaskId}`);
    return this._lastTaskId;
  }

  async _pollResult(taskId) {
    const startTime = Date.now();
    let retries = 0;

    // Initial wait before first poll (2Captcha recommends 10-15s)
    await new Promise(r => setTimeout(r, Math.min(this.pollInterval * 2, 10000)));

    while (Date.now() - startTime < this.timeout) {
      try {
        const resp = await axios.get(`${API_BASE}/res.php`, {
          params: { key: this._apiKey, action: "get", id: taskId, json: 1 },
          timeout: 15000
        });

        const data = resp.data;

        if (data.status === 1) {
          if (this.verbose) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  Captcha solved in ${elapsed}s`);
          }
          return data.request; // the token
        }

        if (data.request === "CAPCHA_NOT_READY") {
          await new Promise(r => setTimeout(r, this.pollInterval));
          continue;
        }

        // Error codes
        if (data.request === "ERROR_CAPTCHA_UNSOLVABLE") {
          throw new Error("2Captcha: captcha unsolvable — verify siteKey is correct");
        }
        if (data.request === "ERROR_TOKEN_EXPIRED") {
          throw new Error("2Captcha: token expired before retrieval");
        }
        throw new Error(`2Captcha polling error: ${data.request}`);

      } catch (err) {
        if (err.message.startsWith("2Captcha")) throw err;
        // Network error — retry up to 3 times
        retries++;
        if (retries > 3) throw new Error(`2Captcha: network error after 3 retries: ${err.message}`);
        if (this.verbose) console.log(`  Captcha poll retry ${retries}: ${err.message}`);
        await new Promise(r => setTimeout(r, this.pollInterval));
      }
    }

    throw new Error(`2Captcha: timeout after ${this.timeout / 1000}s`);
  }
}

module.exports = CaptchaSolver;
