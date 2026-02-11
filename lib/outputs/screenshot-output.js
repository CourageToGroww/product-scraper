const OutputManager = require("../utils/output-manager");

class ScreenshotOutput {
  constructor(outputManager) {
    this.om = outputManager || new OutputManager();
  }

  /**
   * Take a screenshot of a Puppeteer page.
   * @param {import('puppeteer').Page} page
   * @param {string} outputDir
   * @param {string} filename - base name without extension
   * @param {object} opts
   * @param {string} opts.mode - 'fullpage' | 'abovefold' | CSS selector
   * @param {string} opts.format - 'png' | 'jpeg'
   * @param {number} opts.quality - JPEG quality 1-100
   */
  async write(page, outputDir, filename, opts = {}) {
    const mode = opts.mode || "fullpage";
    const format = opts.format || "png";
    const quality = format === "jpeg" ? (opts.quality || 80) : undefined;
    const ext = format === "jpeg" ? ".jpg" : ".png";
    const fullFilename = filename + ext;

    this.om.ensureDir(outputDir);

    const screenshotOpts = { type: format };
    if (quality !== undefined) {
      screenshotOpts.quality = quality;
    }

    let buffer;

    if (mode === "fullpage") {
      screenshotOpts.fullPage = true;
      buffer = await page.screenshot(screenshotOpts);
    } else if (mode === "abovefold") {
      screenshotOpts.fullPage = false;
      buffer = await page.screenshot(screenshotOpts);
    } else {
      // mode is a CSS selector
      const element = await page.$(mode);
      if (!element) {
        throw new Error(`Screenshot selector "${mode}" not found on page`);
      }
      buffer = await element.screenshot(screenshotOpts);
    }

    const result = this.om.writeBinary(outputDir, fullFilename, buffer);
    return { format: "screenshot", mode, imageFormat: format, ...result };
  }

  /**
   * Take a screenshot and return as base64 data URI (no file written).
   * @param {import('puppeteer').Page} page
   * @param {object} opts
   * @param {string} opts.mode - 'fullpage' | 'abovefold' | CSS selector
   * @param {string} opts.format - 'png' | 'jpeg'
   * @param {number} opts.quality - JPEG quality 1-100
   * @returns {{ base64: string, mimeType: string, size: number }}
   */
  async toBase64(page, opts = {}) {
    const mode = opts.mode || "fullpage";
    const format = opts.format || "png";
    const quality = format === "jpeg" ? (opts.quality || 80) : undefined;

    const screenshotOpts = { type: format, encoding: "base64" };
    if (quality !== undefined) {
      screenshotOpts.quality = quality;
    }

    let base64;

    if (mode === "fullpage") {
      screenshotOpts.fullPage = true;
      base64 = await page.screenshot(screenshotOpts);
    } else if (mode === "abovefold") {
      screenshotOpts.fullPage = false;
      base64 = await page.screenshot(screenshotOpts);
    } else {
      const element = await page.$(mode);
      if (!element) {
        throw new Error(`Screenshot selector "${mode}" not found on page`);
      }
      base64 = await element.screenshot(screenshotOpts);
    }

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    return {
      base64: `data:${mimeType};base64,${base64}`,
      mimeType,
      size: Math.ceil(base64.length * 0.75) // approximate decoded size
    };
  }
}

module.exports = ScreenshotOutput;
