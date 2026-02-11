const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const SESSION_VERSION = 1;

class SessionManager {
  constructor({ userAgentRotator = null, proxyRotator = null, sessionFile = null, verbose = false } = {}) {
    this._uaRotator = userAgentRotator;
    this._proxyRotator = proxyRotator;
    this._sessionFile = sessionFile;
    this.verbose = verbose;

    this._pinnedUserAgent = null;
    this._pinnedProxy = null;
    this._cookies = new Map(); // hostname -> cookie[]
    this._sessionId = null;
    this._createdAt = null;
    this._requestCount = 0;
    this._dirty = false;
  }

  initialize() {
    // Try restore from disk first
    if (this._sessionFile && this.restore()) {
      if (this.verbose) {
        console.log(`  Session restored: ${this._sessionId} (${this._requestCount} prior requests)`);
      }
      return this;
    }

    // Fresh session
    this._sessionId = crypto.randomUUID();
    this._createdAt = new Date().toISOString();
    this._pinnedUserAgent = this._uaRotator ? this._uaRotator.get() : DEFAULT_UA;
    this._pinnedProxy = this._proxyRotator ? this._proxyRotator.next() : null;
    this._requestCount = 0;

    if (this.verbose) {
      console.log(`  New session: ${this._sessionId}`);
      console.log(`  Pinned UA: ${this._pinnedUserAgent.substring(0, 60)}...`);
      if (this._pinnedProxy) console.log(`  Pinned proxy: ${this._pinnedProxy}`);
    }

    return this;
  }

  getUserAgent() {
    return this._pinnedUserAgent || DEFAULT_UA;
  }

  getProxy() {
    return this._pinnedProxy || null;
  }

  getCookieHeader(url) {
    const { hostname, pathname, protocol } = new URL(url);
    const isSecure = protocol === "https:";
    const now = Date.now();
    const parts = [];

    for (const [domain, cookies] of this._cookies) {
      if (!this._domainMatches(hostname, domain)) continue;

      for (const cookie of cookies) {
        if (cookie.expires && cookie.expires < now) continue;
        if (cookie.secure && !isSecure) continue;
        if (cookie.path && !pathname.startsWith(cookie.path)) continue;
        parts.push(`${cookie.name}=${cookie.value}`);
      }
    }

    return parts.join("; ");
  }

  setCookiesFromResponse(url, setCookieHeaders) {
    if (!setCookieHeaders) return;

    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    const { hostname, pathname } = new URL(url);

    for (const header of headers) {
      const parsed = this._parseCookie(header, hostname, pathname);
      if (parsed) {
        this._storeCookie(parsed);
      }
    }

    this._dirty = true;
  }

  setCookie(url, name, value, attrs = {}) {
    const { hostname } = new URL(url);
    const cookie = {
      name,
      value,
      domain: attrs.domain || hostname,
      path: attrs.path || "/",
      expires: attrs.expires || null,
      secure: attrs.secure || false,
      httpOnly: attrs.httpOnly || false
    };
    this._storeCookie(cookie);
    this._dirty = true;
  }

  getCookiesForBrowser(url) {
    const { hostname, pathname, protocol } = new URL(url);
    const isSecure = protocol === "https:";
    const now = Date.now();
    const result = [];

    for (const [domain, cookies] of this._cookies) {
      if (!this._domainMatches(hostname, domain)) continue;

      for (const cookie of cookies) {
        if (cookie.expires && cookie.expires < now) continue;
        if (cookie.secure && !isSecure) continue;
        if (cookie.path && !pathname.startsWith(cookie.path)) continue;
        result.push({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain.startsWith(".") ? cookie.domain : "." + cookie.domain,
          path: cookie.path || "/",
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
          ...(cookie.expires ? { expires: cookie.expires / 1000 } : {})
        });
      }
    }

    return result;
  }

  trackRequest() {
    this._requestCount++;
    this._dirty = true;
    return this._requestCount;
  }

  save() {
    if (!this._sessionFile || !this._dirty) return;

    const state = {
      version: SESSION_VERSION,
      sessionId: this._sessionId,
      createdAt: this._createdAt,
      pinnedUserAgent: this._pinnedUserAgent,
      pinnedProxy: this._pinnedProxy,
      requestCount: this._requestCount,
      cookies: {}
    };

    for (const [domain, cookies] of this._cookies) {
      state.cookies[domain] = cookies.filter(c => !c.expires || c.expires > Date.now());
    }

    const dir = path.dirname(this._sessionFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = this._sessionFile + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this._sessionFile);

    this._dirty = false;
    if (this.verbose) console.log(`  Session saved to ${this._sessionFile}`);
  }

  restore() {
    if (!this._sessionFile || !fs.existsSync(this._sessionFile)) return false;

    try {
      const raw = fs.readFileSync(this._sessionFile, "utf-8");
      const state = JSON.parse(raw);

      if (state.version !== SESSION_VERSION) {
        if (this.verbose) console.log("  Session file version mismatch, starting fresh");
        return false;
      }

      this._sessionId = state.sessionId;
      this._createdAt = state.createdAt;
      this._pinnedUserAgent = state.pinnedUserAgent;
      this._pinnedProxy = state.pinnedProxy;
      this._requestCount = state.requestCount || 0;

      // Restore cookies, skipping expired
      const now = Date.now();
      this._cookies = new Map();
      if (state.cookies) {
        for (const [domain, cookies] of Object.entries(state.cookies)) {
          const valid = cookies.filter(c => !c.expires || c.expires > now);
          if (valid.length > 0) this._cookies.set(domain, valid);
        }
      }

      this._dirty = false;
      return true;
    } catch (err) {
      if (this.verbose) console.log(`  Failed to restore session: ${err.message}`);
      return false;
    }
  }

  destroy() {
    if (this._sessionFile && fs.existsSync(this._sessionFile)) {
      fs.unlinkSync(this._sessionFile);
      if (this.verbose) console.log(`  Session file deleted: ${this._sessionFile}`);
    }
  }

  summary() {
    let cookieCount = 0;
    for (const cookies of this._cookies.values()) {
      cookieCount += cookies.length;
    }

    return {
      sessionId: this._sessionId,
      userAgent: this._pinnedUserAgent ? this._pinnedUserAgent.substring(0, 50) + "..." : "none",
      proxy: this._pinnedProxy || "none",
      cookieCount,
      requestCount: this._requestCount,
      age: this._createdAt ? `${((Date.now() - new Date(this._createdAt).getTime()) / 1000).toFixed(0)}s` : "unknown"
    };
  }

  // --- Private methods ---

  _domainMatches(hostname, cookieDomain) {
    const domain = cookieDomain.startsWith(".") ? cookieDomain.substring(1) : cookieDomain;
    return hostname === domain || hostname.endsWith("." + domain);
  }

  _storeCookie(cookie) {
    const domain = (cookie.domain || "").replace(/^\./, "");
    if (!domain) return;

    if (!this._cookies.has(domain)) {
      this._cookies.set(domain, []);
    }

    const cookies = this._cookies.get(domain);
    // Replace existing cookie with same name+path
    const idx = cookies.findIndex(c => c.name === cookie.name && c.path === cookie.path);
    if (idx >= 0) {
      cookies[idx] = cookie;
    } else {
      cookies.push(cookie);
    }
  }

  _parseCookie(header, defaultDomain, defaultPath) {
    const parts = header.split(";").map(p => p.trim());
    if (parts.length === 0) return null;

    // First part is name=value
    const eqIdx = parts[0].indexOf("=");
    if (eqIdx < 0) return null;

    const name = parts[0].substring(0, eqIdx).trim();
    const value = parts[0].substring(eqIdx + 1).trim();
    if (!name) return null;

    const cookie = {
      name,
      value,
      domain: defaultDomain,
      path: defaultPath || "/",
      expires: null,
      secure: false,
      httpOnly: false
    };

    // Parse attributes
    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i];
      const attrEq = attr.indexOf("=");
      const attrName = (attrEq >= 0 ? attr.substring(0, attrEq) : attr).trim().toLowerCase();
      const attrValue = attrEq >= 0 ? attr.substring(attrEq + 1).trim() : "";

      switch (attrName) {
        case "domain":
          if (attrValue) cookie.domain = attrValue.replace(/^\./, "");
          break;
        case "path":
          if (attrValue) cookie.path = attrValue;
          break;
        case "expires":
          if (attrValue) {
            const d = new Date(attrValue);
            if (!isNaN(d.getTime())) cookie.expires = d.getTime();
          }
          break;
        case "max-age":
          if (attrValue) {
            const seconds = parseInt(attrValue, 10);
            if (!isNaN(seconds)) cookie.expires = Date.now() + seconds * 1000;
          }
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "httponly":
          cookie.httpOnly = true;
          break;
      }
    }

    return cookie;
  }
}

module.exports = SessionManager;
