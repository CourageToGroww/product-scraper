const cheerio = require("cheerio");
const OutputManager = require("../utils/output-manager");

class TextOutput {
  constructor(outputManager) {
    this.om = outputManager || new OutputManager();
  }

  convert(html) {
    const $ = cheerio.load(html);

    // Remove script and style elements
    $("script, style, noscript").remove();

    // Get text, collapse whitespace
    return $.root().text()
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim();
  }

  write(html, outputDir, filename = "page.txt") {
    const text = this.convert(html);
    const result = this.om.writeFile(outputDir, filename, text);
    return { format: "text", ...result };
  }
}

module.exports = TextOutput;
