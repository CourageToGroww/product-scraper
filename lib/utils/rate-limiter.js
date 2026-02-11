const pLimit = require("p-limit");

class RateLimiter {
  constructor({ concurrency = 3, delay = 200 } = {}) {
    this.limiter = pLimit(concurrency);
    this.delay = delay;
    this.lastRequestTime = 0;
  }

  async execute(fn) {
    return this.limiter(async () => {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.delay) {
        await new Promise(r => setTimeout(r, this.delay - elapsed));
      }
      this.lastRequestTime = Date.now();
      return fn();
    });
  }

  async executeAll(fns) {
    return Promise.all(fns.map(fn => this.execute(fn)));
  }
}

module.exports = RateLimiter;
