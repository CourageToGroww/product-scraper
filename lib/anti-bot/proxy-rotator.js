const fs = require("fs");

class ProxyRotator {
  /**
   * @param {string[]|string} proxies - Array of proxy URLs or path to JSON file
   */
  constructor(proxies) {
    if (typeof proxies === "string") {
      const raw = fs.readFileSync(proxies, "utf-8");
      this.proxies = JSON.parse(raw);
    } else {
      this.proxies = proxies || [];
    }

    this.index = 0;

    if (this.proxies.length === 0) {
      throw new Error("ProxyRotator requires at least one proxy URL");
    }
  }

  next() {
    const proxy = this.proxies[this.index % this.proxies.length];
    this.index++;
    return proxy;
  }

  current() {
    return this.proxies[(this.index - 1) % this.proxies.length] || this.proxies[0];
  }

  count() {
    return this.proxies.length;
  }
}

module.exports = ProxyRotator;
