const TurndownService = require("turndown");
const OutputManager = require("../utils/output-manager");

class MarkdownOutput {
  constructor(outputManager) {
    this.om = outputManager || new OutputManager();
    this.turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-"
    });
  }

  convert(html) {
    return this.turndown.turndown(html);
  }

  write(html, outputDir, filename = "page.md") {
    const markdown = this.convert(html);
    const result = this.om.writeFile(outputDir, filename, markdown);
    return { format: "markdown", ...result };
  }
}

module.exports = MarkdownOutput;
