/**
 * ResponseConverter — Converts HTML responses to markdown or plaintext.
 * Matches ZenRows' response_type parameter.
 */
class ResponseConverter {
  /**
   * Convert HTML to the specified type.
   * @param {string} html - Raw HTML content
   * @param {string} type - "markdown" | "plaintext" | "html" (passthrough)
   * @returns {string} Converted content
   */
  convert(html, type) {
    if (!html || !type || type === "html") return html;

    switch (type.toLowerCase()) {
      case "markdown":
      case "md":
        return this._toMarkdown(html);
      case "plaintext":
      case "text":
        return this._toPlaintext(html);
      default:
        return html;
    }
  }

  _toMarkdown(html) {
    const TurndownService = require("turndown");
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "_"
    });

    // Custom rules for better output
    td.addRule("removeScripts", {
      filter: ["script", "style", "noscript"],
      replacement: () => ""
    });

    td.addRule("tables", {
      filter: "table",
      replacement: (content, node) => {
        // Simple table conversion
        const rows = node.querySelectorAll ? Array.from(node.querySelectorAll("tr")) : [];
        if (rows.length === 0) return content;
        return "\n" + content + "\n";
      }
    });

    return td.turndown(html).trim();
  }

  _toPlaintext(html) {
    const { convert } = require("html-to-text");
    return convert(html, {
      wordwrap: 120,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" }
      ]
    }).trim();
  }
}

module.exports = ResponseConverter;
