class NetworkInterceptor {
  constructor({ patterns = [], verbose = false } = {}) {
    this.patterns = patterns;
    this.verbose = verbose;
    this._responses = [];
    this._startTime = null;
    this._handler = null;
  }

  attach(page) {
    this._startTime = Date.now();
    this._responses = [];

    this._handler = async (response) => {
      try {
        const request = response.request();
        const resourceType = request.resourceType();

        if (resourceType !== "xhr" && resourceType !== "fetch") return;

        const url = response.url();

        // Filter by patterns if provided
        if (this.patterns.length > 0) {
          const matches = this.patterns.some(p => url.includes(p));
          if (!matches) return;
        }

        let body = null;
        try {
          const text = await response.text();
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        } catch {
          body = null;
        }

        this._responses.push({
          url,
          method: request.method(),
          status: response.status(),
          headers: response.headers(),
          body,
          resourceType,
          timing: Date.now() - this._startTime
        });

        if (this.verbose) {
          console.log(`  Captured ${request.method()} ${url.substring(0, 80)} (${response.status()})`);
        }
      } catch {
        // Response may be unavailable (e.g., aborted requests)
      }
    };

    page.on("response", this._handler);
  }

  detach(page) {
    if (this._handler) {
      page.off("response", this._handler);
      this._handler = null;
    }
  }

  getResponses() {
    return this._responses;
  }

  get count() {
    return this._responses.length;
  }
}

module.exports = NetworkInterceptor;
