import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default class ScraperBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.running = false;
    this.result = null;
  }

  async run(urls, scrapeOpts = {}) {
    this.running = true;
    this.result = null;
    this.emit("start");

    const GenericScraper = require("../../lib/scrapers/generic-scraper");

    const logs = [];
    const logger = {
      log: (...args) => {
        const msg = args.join(" ");
        logs.push(msg);
        this.emit("log", msg);
      },
      error: (...args) => {
        const msg = args.join(" ");
        logs.push(`[ERROR] ${msg}`);
        this.emit("log", `[ERROR] ${msg}`);
      }
    };

    const onProgress = (event) => {
      this.emit("progress", event);
    };

    try {
      const scraper = new GenericScraper({
        ...this.options,
        logger,
        onProgress
      });

      this.result = await scraper.scrape(urls, scrapeOpts);
      this.emit("done", this.result);
      return this.result;
    } catch (err) {
      this.emit("error", err);
      throw err;
    } finally {
      this.running = false;
    }
  }
}
