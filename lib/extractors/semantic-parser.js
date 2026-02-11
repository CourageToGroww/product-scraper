"use strict";

/**
 * Semantic Content Detection
 *
 * Analyzes HTML to detect the type of content (product listing, product detail,
 * article, table data) and suggests extraction configurations automatically.
 */

// ── Schema.org Detection ──────────────────────────────────────────────

const SCHEMA_ORG_PATTERNS = {
  product: [
    /@type["'\s:]+Product/i,
    /itemtype=["']https?:\/\/schema\.org\/Product/i,
    /og:type["'\s]+content=["']product/i,
    /<meta[^>]+property=["']og:type["'][^>]+content=["']product/i,
    /<meta[^>]+content=["']product["'][^>]+property=["']og:type/i,
  ],
  article: [
    /@type["'\s:]+Article/i,
    /@type["'\s:]+NewsArticle/i,
    /@type["'\s:]+BlogPosting/i,
    /itemtype=["']https?:\/\/schema\.org\/Article/i,
    /itemtype=["']https?:\/\/schema\.org\/NewsArticle/i,
    /itemtype=["']https?:\/\/schema\.org\/BlogPosting/i,
    /<meta[^>]+property=["']og:type["'][^>]+content=["']article/i,
    /<meta[^>]+content=["']article["'][^>]+property=["']og:type/i,
  ],
};

// ── Price Patterns ────────────────────────────────────────────────────

const CURRENCY_SYMBOLS = ["$", "€", "£", "¥", "₹", "₽", "₩", "฿", "₫", "₺", "₴", "₦", "R$", "kr", "zł"];
const PRICE_REGEX = /(?:[$€£¥₹₽₩฿₫₺₴₦]|R\$|kr|zł)\s*\d[\d,.']*|\d[\d,.']*\s*(?:[$€£¥₹₽₩฿₫₺₴₦]|R\$|kr|zł|USD|EUR|GBP|THB|JPY|CNY|KRW|VND)/gi;

// ── Common Selectors ──────────────────────────────────────────────────

const PRODUCT_CARD_SELECTORS = [
  ".product-card", ".product-item", ".product-tile",
  "[data-product]", "[data-product-id]",
  ".product", ".product-listing",
  ".item-card", ".goods-item",
  ".woocommerce-loop-product",
  ".shopify-product", ".grid-product",
];

const PRODUCT_DETAIL_SELECTORS = [
  ".product-detail", ".product-page", ".product-info",
  ".product-main", "#product-detail", "[data-product-detail]",
  ".product-single", ".product-template",
];

const ARTICLE_SELECTORS = [
  "article", ".post-content", ".entry-content",
  ".article-content", ".post-body", ".blog-post",
  ".story-body", "[role='article']",
];

// ── Repeated Element Detection ────────────────────────────────────────

/**
 * Find containers with repeated similar child structures.
 * Returns the best candidate wrapper selector and a structural fingerprint.
 */
function findRepeatedStructures(cheerio, $) {
  const candidates = [];

  // Check common grid/list containers
  const containerSelectors = [
    "ul", "ol", ".grid", ".list", ".row", ".products",
    ".items", ".cards", ".results", "[class*='grid']",
    "[class*='product']", "[class*='item']", "[class*='card']",
    "main", "section", ".container",
  ];

  for (const sel of containerSelectors) {
    $(sel).each(function () {
      const $el = $(this);
      const children = $el.children();
      if (children.length < 3) return;

      // Check if children have similar structure
      const fingerprints = [];
      children.each(function () {
        const $child = $(this);
        const hasImg = $child.find("img").length > 0;
        const hasLink = $child.find("a").length > 0;
        const textLen = ($child.text() || "").trim().length;
        const tagName = (this.tagName || this.name || "").toLowerCase();
        const childCount = $child.children().length;
        fingerprints.push(`${tagName}:img=${hasImg}:a=${hasLink}:c=${childCount}:t=${textLen > 10}`);
      });

      // Count most common fingerprint
      const counts = {};
      for (const fp of fingerprints) {
        counts[fp] = (counts[fp] || 0) + 1;
      }
      const maxCount = Math.max(...Object.values(counts));
      const dominantFp = Object.keys(counts).find(k => counts[k] === maxCount);

      if (maxCount >= 3 && maxCount / fingerprints.length >= 0.6) {
        // This container has repeated similar children
        const sampleChild = children.first();
        const hasImage = sampleChild.find("img").length > 0;
        const hasPrice = PRICE_REGEX.test(sampleChild.text() || "");
        PRICE_REGEX.lastIndex = 0;

        candidates.push({
          selector: buildSelector($el, $),
          childSelector: buildChildSelector(sampleChild, $),
          count: maxCount,
          hasImage,
          hasPrice,
          dominantFingerprint: dominantFp,
          score: maxCount * (hasImage ? 2 : 1) * (hasPrice ? 3 : 1),
        });
      }
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

/**
 * Build a reasonable CSS selector for an element.
 */
function buildSelector($el, $) {
  // Try ID first
  const id = $el.attr("id");
  if (id) return `#${id}`;

  // Try class-based selector
  const classes = ($el.attr("class") || "").split(/\s+/).filter(Boolean);
  const tagName = ($el.prop("tagName") || $el.get(0)?.tagName || $el.get(0)?.name || "div").toLowerCase();

  if (classes.length > 0) {
    // Use the most specific-looking class
    const bestClass = classes.find(c => !c.match(/^(col|row|flex|grid|d-|p-|m-|w-|h-)/)) || classes[0];
    return `${tagName}.${bestClass}`;
  }

  return tagName;
}

/**
 * Build a selector for a child element (relative to its parent).
 */
function buildChildSelector($el, $) {
  const tagName = ($el.prop("tagName") || $el.get(0)?.tagName || $el.get(0)?.name || "div").toLowerCase();
  const classes = ($el.attr("class") || "").split(/\s+/).filter(Boolean);

  if (classes.length > 0) {
    const bestClass = classes.find(c => !c.match(/^(col|row|flex|grid|d-|p-|m-|w-|h-)/)) || classes[0];
    return `${tagName}.${bestClass}`;
  }

  return tagName;
}

// ── Field Extraction Mapping ──────────────────────────────────────────

/**
 * Given a sample element from a repeated list, try to identify
 * which child elements correspond to name, price, image, link, etc.
 */
function detectFields(cheerio, $, $sample) {
  const fields = {};

  // Image
  const $img = $sample.find("img").first();
  if ($img.length) {
    const imgSel = buildInnerSelector($img, $sample, $);
    fields.image = { selector: imgSel, attr: "src" };

    // Alt text is often the product name
    if ($img.attr("alt") && !fields.name) {
      fields.name = { selector: imgSel, attr: "alt" };
    }
  }

  // Link
  const $link = $sample.find("a").first();
  if ($link.length) {
    fields.link = { selector: buildInnerSelector($link, $sample, $), attr: "href" };

    // Link text is often the name
    const linkText = ($link.text() || "").trim();
    if (linkText.length > 3 && linkText.length < 200) {
      fields.name = { selector: buildInnerSelector($link, $sample, $) };
    }
  }

  // Price — find element containing price pattern
  $sample.find("*").each(function () {
    const $el = $(this);
    const text = ($el.clone().children().remove().end().text() || "").trim();
    if (PRICE_REGEX.test(text)) {
      PRICE_REGEX.lastIndex = 0;
      fields.price = { selector: buildInnerSelector($el, $sample, $) };
      return false; // break
    }
    PRICE_REGEX.lastIndex = 0;
  });

  // Heading — h1-h6 often contains the name
  for (let i = 1; i <= 6; i++) {
    const $heading = $sample.find(`h${i}`).first();
    if ($heading.length) {
      const headingText = ($heading.text() || "").trim();
      if (headingText.length > 2 && headingText.length < 200) {
        fields.name = { selector: buildInnerSelector($heading, $sample, $) };
        break;
      }
    }
  }

  return fields;
}

/**
 * Build an inner selector relative to the container.
 */
function buildInnerSelector($el, $container, $) {
  const tagName = ($el.prop("tagName") || $el.get(0)?.tagName || $el.get(0)?.name || "").toLowerCase();
  const classes = ($el.attr("class") || "").split(/\s+/).filter(Boolean);

  if (classes.length > 0) {
    const bestClass = classes.find(c => !c.match(/^(col|row|flex|grid|d-|p-|m-|w-|h-)/)) || classes[0];
    return `${tagName}.${bestClass}`;
  }

  return tagName;
}

// ── Main Detection Function ───────────────────────────────────────────

/**
 * Analyze HTML to detect what type of content it contains and suggest
 * an extraction configuration.
 *
 * @param {string} html - Raw HTML to analyze
 * @param {Function} loadCheerio - Function that returns the cheerio module
 * @returns {{ type: string, confidence: number, suggestedConfig?: object }}
 */
function detectContentType(html, loadCheerio) {
  const cheerio = loadCheerio();
  const $ = cheerio.load(html);

  const signals = {
    schemaProduct: false,
    schemaArticle: false,
    priceCount: 0,
    productCardCount: 0,
    productDetailSelectors: 0,
    articleSelectors: 0,
    repeatedStructures: [],
    tableCount: 0,
  };

  // 1. Schema.org / Open Graph detection
  const headHtml = $("head").html() || "";
  const bodyHtml = html.slice(0, 5000); // Check first 5KB for meta tags

  for (const pat of SCHEMA_ORG_PATTERNS.product) {
    if (pat.test(headHtml) || pat.test(bodyHtml)) {
      signals.schemaProduct = true;
      break;
    }
  }
  for (const pat of SCHEMA_ORG_PATTERNS.article) {
    if (pat.test(headHtml) || pat.test(bodyHtml)) {
      signals.schemaArticle = true;
      break;
    }
  }

  // Check JSON-LD
  $("script[type='application/ld+json']").each(function () {
    const text = $(this).html() || "";
    if (/"@type"\s*:\s*"Product"/i.test(text)) signals.schemaProduct = true;
    if (/"@type"\s*:\s*"(Article|NewsArticle|BlogPosting)"/i.test(text)) signals.schemaArticle = true;
  });

  // 2. Price pattern count
  const bodyText = $("body").text() || "";
  const priceMatches = bodyText.match(PRICE_REGEX) || [];
  signals.priceCount = priceMatches.length;

  // 3. Product card selectors
  for (const sel of PRODUCT_CARD_SELECTORS) {
    signals.productCardCount += $(sel).length;
  }

  // 4. Product detail selectors
  for (const sel of PRODUCT_DETAIL_SELECTORS) {
    signals.productDetailSelectors += $(sel).length;
  }

  // 5. Article selectors
  for (const sel of ARTICLE_SELECTORS) {
    signals.articleSelectors += $(sel).length;
  }

  // 6. Repeated structures
  signals.repeatedStructures = findRepeatedStructures(cheerio, $);

  // 7. Tables
  signals.tableCount = $("table").length;

  // ── Scoring ──────────────────────────────────────────────────────

  const scores = {
    "product-listing": 0,
    "product-detail": 0,
    "article": 0,
    "table-data": 0,
    "unknown": 0.1,
  };

  // Product listing signals
  if (signals.schemaProduct && signals.productCardCount >= 3) scores["product-listing"] += 0.4;
  if (signals.productCardCount >= 3) scores["product-listing"] += 0.2;
  if (signals.priceCount >= 3) scores["product-listing"] += 0.2;
  if (signals.repeatedStructures.length > 0 && signals.repeatedStructures[0].hasPrice) {
    scores["product-listing"] += 0.3;
  }
  if (signals.repeatedStructures.length > 0 && signals.repeatedStructures[0].hasImage && signals.repeatedStructures[0].count >= 5) {
    scores["product-listing"] += 0.2;
  }

  // Product detail signals
  if (signals.schemaProduct && signals.productCardCount < 3) scores["product-detail"] += 0.5;
  if (signals.productDetailSelectors > 0) scores["product-detail"] += 0.3;
  if (signals.priceCount >= 1 && signals.priceCount <= 3) scores["product-detail"] += 0.1;

  // Article signals
  if (signals.schemaArticle) scores["article"] += 0.5;
  if (signals.articleSelectors > 0) scores["article"] += 0.3;
  if ($("article").length > 0) scores["article"] += 0.2;

  // Table data signals
  if (signals.tableCount > 0) {
    const rows = $("table").first().find("tr").length;
    if (rows >= 3) scores["table-data"] += 0.3 + Math.min(rows / 50, 0.4);
  }

  // Find the winner
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [type, score] = sorted[0];
  const confidence = Math.min(score, 1.0);

  // ── Build Suggested Config ──────────────────────────────────────

  let suggestedConfig = undefined;

  if (type === "product-listing" && signals.repeatedStructures.length > 0) {
    const best = signals.repeatedStructures[0];
    const $wrapper = $(best.selector);
    const $firstChild = $wrapper.children().first();
    const fields = detectFields(cheerio, $, $firstChild);

    suggestedConfig = {
      mode: "list",
      config: {
        wrapper: best.selector + " > " + best.childSelector,
        fields: Object.fromEntries(
          Object.entries(fields).map(([name, f]) => [
            name,
            f.attr ? `${f.selector}@${f.attr}` : f.selector,
          ])
        ),
      },
    };
  } else if (type === "product-detail") {
    // Suggest CSS extraction for common product fields
    const fields = {};
    const nameSel = $("h1").first();
    if (nameSel.length) fields.name = "h1";

    // Find price
    $("[class*='price'], [id*='price'], .amount, .money").each(function () {
      const text = ($(this).text() || "").trim();
      if (PRICE_REGEX.test(text)) {
        PRICE_REGEX.lastIndex = 0;
        fields.price = buildSelector($(this), $);
        return false;
      }
      PRICE_REGEX.lastIndex = 0;
    });

    // Find main image
    const $mainImg = $(".product-image img, .product-photo img, [data-product-image], .gallery img").first();
    if ($mainImg.length) {
      fields.image = buildSelector($mainImg, $) + "@src";
    }

    // Find description
    const $desc = $(".product-description, .description, [itemprop='description']").first();
    if ($desc.length) {
      fields.description = buildSelector($desc, $);
    }

    if (Object.keys(fields).length > 0) {
      suggestedConfig = { mode: "css", config: { selectors: fields } };
    }
  } else if (type === "article") {
    suggestedConfig = {
      mode: "convert",
      config: { format: "markdown" },
    };
  } else if (type === "table-data") {
    suggestedConfig = {
      mode: "autoparse",
      config: { category: "tables" },
    };
  }

  return {
    type,
    confidence: Math.round(confidence * 100) / 100,
    suggestedConfig,
    signals: {
      schemaProduct: signals.schemaProduct,
      schemaArticle: signals.schemaArticle,
      priceCount: signals.priceCount,
      productCardCount: signals.productCardCount,
      repeatedItemCount: signals.repeatedStructures[0]?.count || 0,
      tableCount: signals.tableCount,
    },
  };
}

module.exports = { detectContentType, CURRENCY_SYMBOLS, PRICE_REGEX };
