const OutputManager = require("../utils/output-manager");

class PdfOutput {
  constructor(outputManager) {
    this.om = outputManager || new OutputManager();
  }

  /**
   * Generate PDF from a Puppeteer page.
   * @param {import('puppeteer').Page} page
   * @param {string} outputDir
   * @param {string} filename
   * @param {object} opts
   * @param {string} opts.paperSize - 'letter' | 'a4' | 'legal'
   * @param {boolean} opts.landscape
   * @param {boolean} opts.printBackground
   */
  async write(page, outputDir, filename = "page.pdf", opts = {}) {
    const paperSize = opts.paperSize || "letter";
    const landscape = opts.landscape || false;
    const printBackground = opts.printBackground !== false;

    this.om.ensureDir(outputDir);

    const buffer = await page.pdf({
      format: paperSize,
      landscape,
      printBackground,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" }
    });

    const result = this.om.writeBinary(outputDir, filename, buffer);
    return { format: "pdf", paperSize, ...result };
  }
}

module.exports = PdfOutput;
