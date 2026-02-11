const axios = require("axios");
const axiosRetry = require("axios-retry").default;

class HttpClient {
  constructor({
    timeout = 30000,
    retries = 3,
    retryDelay = "exponential",
    headers = {},
    cookies = null,
    proxy = null,
    userAgentRotator = null,
    proxyRotator = null,
    sessionManager = null,
    allowedStatus = null,
    method = "GET",
    requestBody = null,
    verbose = false
  } = {}) {
    this.timeout = timeout;
    this.verbose = verbose;
    this.userAgentRotator = userAgentRotator;
    this.proxyRotator = proxyRotator;
    this.sessionManager = sessionManager;
    this.defaultHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ...headers
    };
    this.cookies = cookies;
    this.staticProxy = proxy;
    this.allowedStatus = allowedStatus;
    this.method = (method || "GET").toUpperCase();
    this.requestBody = requestBody;

    this.client = axios.create({
      timeout,
      validateStatus: (status) => {
        // Accept all status codes, we'll validate later
        if (this.allowedStatus) return true;
        return status < 400;
      }
    });

    axiosRetry(this.client, {
      retries,
      retryDelay: retryDelay === "exponential"
        ? axiosRetry.exponentialDelay
        : (retryCount) => retryCount * 1000,
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          (error.response && error.response.status >= 500);
      },
      onRetry: (retryCount, error) => {
        if (this.verbose) {
          console.log(`  Retry ${retryCount}: ${error.message}`);
        }
      }
    });
  }

  _buildHeaders(extraHeaders, url) {
    const headers = { ...this.defaultHeaders, ...extraHeaders };

    if (this.sessionManager) {
      headers["User-Agent"] = this.sessionManager.getUserAgent();
      const cookieHeader = this.sessionManager.getCookieHeader(url);
      if (cookieHeader) headers["Cookie"] = cookieHeader;
    } else {
      if (this.userAgentRotator) {
        headers["User-Agent"] = this.userAgentRotator.get();
      }
      if (this.cookies) {
        headers["Cookie"] = this.cookies;
      }
    }

    return headers;
  }

  _buildConfig(extraHeaders, extraConfig, url) {
    const config = {
      headers: this._buildHeaders(extraHeaders, url),
      ...extraConfig
    };

    let proxy;
    if (this.sessionManager) {
      proxy = this.sessionManager.getProxy();
    } else {
      proxy = this.proxyRotator ? this.proxyRotator.next() : this.staticProxy;
    }

    if (proxy) {
      const proxyUrl = new URL(proxy);
      config.proxy = {
        protocol: proxyUrl.protocol.replace(":", ""),
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port),
        ...(proxyUrl.username && {
          auth: { username: proxyUrl.username, password: proxyUrl.password }
        })
      };
    }

    return config;
  }

  _trackSession(url, resp) {
    if (!this.sessionManager) return;
    this.sessionManager.setCookiesFromResponse(url, resp.headers["set-cookie"]);
    this.sessionManager.trackRequest();
  }

  async fetch(url, { headers = {}, method: overrideMethod, body: overrideBody, ...extra } = {}) {
    const start = Date.now();
    const httpMethod = (overrideMethod || this.method || "GET").toUpperCase();
    const reqBody = overrideBody || this.requestBody || null;
    if (this.verbose) console.log(`  ${httpMethod} ${url}`);

    const config = this._buildConfig(headers, extra, url);
    let resp;
    if (httpMethod === "GET") {
      resp = await this.client.get(url, config);
    } else if (httpMethod === "POST") {
      resp = await this.client.post(url, reqBody, config);
    } else if (httpMethod === "PUT") {
      resp = await this.client.put(url, reqBody, config);
    } else if (httpMethod === "PATCH") {
      resp = await this.client.patch(url, reqBody, config);
    } else if (httpMethod === "DELETE") {
      resp = await this.client.delete(url, { ...config, data: reqBody });
    } else if (httpMethod === "HEAD") {
      resp = await this.client.head(url, config);
    } else {
      resp = await this.client.request({ ...config, method: httpMethod, url, data: reqBody });
    }
    this._trackSession(url, resp);

    // Validate status code
    if (resp.status >= 400 && this.allowedStatus && !this.allowedStatus.includes(resp.status)) {
      const err = new Error(`HTTP ${resp.status} (not in allowed status codes)`);
      err.response = resp;
      throw err;
    }

    return {
      status: resp.status,
      headers: resp.headers,
      html: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data),
      data: resp.data,
      url: resp.request?.res?.responseUrl || url,
      timing: Date.now() - start,
      originalStatus: resp.status
    };
  }

  async fetchJSON(url, { headers = {}, ...extra } = {}) {
    const config = this._buildConfig({ Accept: "application/json", ...headers }, extra, url);
    const start = Date.now();
    if (this.verbose) console.log(`  GET (JSON) ${url}`);

    const resp = await this.client.get(url, config);
    this._trackSession(url, resp);

    return {
      status: resp.status,
      headers: resp.headers,
      data: resp.data,
      url: resp.request?.res?.responseUrl || url,
      timing: Date.now() - start
    };
  }

  async download(url, { headers = {} } = {}) {
    const config = this._buildConfig(headers, { responseType: "arraybuffer" }, url);
    const resp = await this.client.get(url, config);
    this._trackSession(url, resp);
    return {
      data: resp.data,
      contentType: resp.headers["content-type"] || "",
      size: resp.data.length
    };
  }
}

module.exports = HttpClient;
