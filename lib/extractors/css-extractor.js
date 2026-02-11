const cheerio = require("cheerio");

class CssExtractor {
  /**
   * Extract data from HTML using a CSS selector schema.
   *
   * Schema format:
   *   { "key": "selector" }           → text content (array if multiple matches)
   *   { "key": "selector @attr" }     → attribute value (e.g. "a @href", "img @src")
   *   { "key": "selector @html" }     → inner HTML
   *
   * @param {string} html - Raw HTML string
   * @param {object} schema - Extraction schema
   * @returns {object} Extracted data keyed by schema keys
   */
  extract(html, schema) {
    const $ = cheerio.load(html);
    const result = {};

    for (const [key, selectorExpr] of Object.entries(schema)) {
      result[key] = this._extractField($, selectorExpr);
    }

    return result;
  }

  _extractField($, selectorExpr) {
    const { selector, attribute } = this._parseSelector(selectorExpr);
    const elements = $(selector);

    if (elements.length === 0) return null;

    const values = [];
    elements.each((_, el) => {
      const $el = $(el);
      let value;

      if (attribute === "@html") {
        value = $el.html();
      } else if (attribute) {
        value = $el.attr(attribute.replace("@", ""));
      } else {
        value = $el.text().trim();
      }

      if (value !== undefined && value !== null && value !== "") {
        values.push(value);
      }
    });

    // Single match returns string, multiple returns array
    return values.length === 1 ? values[0] : values.length === 0 ? null : values;
  }

  _parseSelector(expr) {
    const trimmed = expr.trim();

    // Check for @attr at the end: "a @href", "img @src", ".el @data-id"
    const attrMatch = trimmed.match(/^(.+?)\s+(@\w[\w-]*)$/);
    if (attrMatch) {
      return { selector: attrMatch[1].trim(), attribute: attrMatch[2] };
    }

    return { selector: trimmed, attribute: null };
  }

  /**
   * Extract a single value using a CSS selector.
   */
  extractOne(html, selector, attribute = null) {
    const $ = cheerio.load(html);
    const el = $(selector).first();
    if (el.length === 0) return null;

    if (attribute) return el.attr(attribute);
    return el.text().trim();
  }

  /**
   * Extract all matching values using a CSS selector.
   */
  extractAll(html, selector, attribute = null) {
    const $ = cheerio.load(html);
    const values = [];

    $(selector).each((_, el) => {
      const $el = $(el);
      const value = attribute ? $el.attr(attribute) : $el.text().trim();
      if (value) values.push(value);
    });

    return values;
  }
}

module.exports = CssExtractor;
