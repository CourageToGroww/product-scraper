const cheerio = require("cheerio");

class AutoParser {
  /**
   * Auto-extract structured data from HTML.
   *
   * @param {string} html - Raw HTML string
   * @param {string[]} filters - Data types to extract. Use ["all"] for everything.
   * @returns {object} Extracted data keyed by filter name
   */
  parse(html, filters = ["all"]) {
    const $ = cheerio.load(html);
    const wantAll = filters.includes("all");
    const result = {};

    const parsers = {
      emails: () => this._extractEmails(html, $),
      phones: () => this._extractPhones(html, $),
      headings: () => this._extractHeadings($),
      images: () => this._extractImages($),
      links: () => this._extractLinks($),
      tables: () => this._extractTables($),
      metadata: () => this._extractMetadata($),
      videos: () => this._extractVideos($),
      audios: () => this._extractAudios($),
      hashtags: () => this._extractHashtags(html),
      favicons: () => this._extractFavicons($),
      menus: () => this._extractMenus($)
    };

    for (const [name, fn] of Object.entries(parsers)) {
      if (wantAll || filters.includes(name)) {
        result[name] = fn();
      }
    }

    return result;
  }

  _extractEmails(html, $) {
    const emails = new Set();

    // From mailto: links
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr("href") || "";
      const email = href.replace("mailto:", "").split("?")[0].trim();
      if (email) emails.add(email.toLowerCase());
    });

    // From text content via regex
    const text = $.root().text();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = text.match(emailRegex) || [];
    for (const m of matches) emails.add(m.toLowerCase());

    // Check for obfuscated emails (common patterns)
    const obfuscated = html.match(/[\w.+-]+\s*\[at\]\s*[\w.-]+\s*\[dot\]\s*\w+/gi) || [];
    for (const o of obfuscated) {
      const clean = o.replace(/\s*\[at\]\s*/i, "@").replace(/\s*\[dot\]\s*/gi, ".");
      emails.add(clean.toLowerCase());
    }

    return [...emails];
  }

  _extractPhones(html, $) {
    const phones = new Set();

    // From tel: links
    $('a[href^="tel:"]').each((_, el) => {
      const href = $(el).attr("href") || "";
      const phone = href.replace("tel:", "").trim();
      if (phone) phones.add(phone);
    });

    // From text via regex (international and common formats)
    const text = $.root().text();
    const phoneRegex = /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{1,4}\)?[-.\s]?)?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
    const matches = text.match(phoneRegex) || [];
    for (const m of matches) {
      const cleaned = m.replace(/\s+/g, " ").trim();
      // Only include if it looks like a real phone (7+ digits)
      const digitCount = cleaned.replace(/\D/g, "").length;
      if (digitCount >= 7 && digitCount <= 15) {
        phones.add(cleaned);
      }
    }

    return [...phones];
  }

  _extractHeadings($) {
    const headings = {};
    for (let level = 1; level <= 6; level++) {
      const items = [];
      $(`h${level}`).each((_, el) => {
        const text = $(el).text().trim();
        if (text) items.push(text);
      });
      if (items.length > 0) {
        headings[`h${level}`] = items;
      }
    }
    return headings;
  }

  _extractImages($) {
    const images = [];
    $("img").each((_, el) => {
      const $el = $(el);
      const src = $el.attr("src");
      if (src) {
        images.push({
          src,
          alt: $el.attr("alt") || "",
          width: $el.attr("width") || "",
          height: $el.attr("height") || ""
        });
      }
    });

    // Also check picture > source elements
    $("picture source").each((_, el) => {
      const srcset = $(el).attr("srcset");
      if (srcset) {
        images.push({ src: srcset.split(",")[0].trim().split(" ")[0], alt: "", type: "srcset" });
      }
    });

    return images;
  }

  _extractLinks($) {
    const links = [];
    $("a[href]").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");
      if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
        links.push({
          href,
          text: $el.text().trim().substring(0, 200),
          rel: $el.attr("rel") || "",
          target: $el.attr("target") || ""
        });
      }
    });
    return links;
  }

  _extractTables($) {
    const tables = [];
    $("table").each((_, table) => {
      const $table = $(table);
      const headers = [];
      const rows = [];

      $table.find("thead th, thead td, tr:first-child th").each((_, th) => {
        headers.push($(th).text().trim());
      });

      const dataRows = headers.length > 0
        ? $table.find("tbody tr, tr:not(:first-child)")
        : $table.find("tr");

      dataRows.each((_, tr) => {
        const cells = [];
        $(tr).find("td, th").each((_, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length > 0) rows.push(cells);
      });

      tables.push({
        headers,
        rows,
        rowCount: rows.length,
        colCount: Math.max(headers.length, rows[0]?.length || 0)
      });
    });
    return tables;
  }

  _extractMetadata($) {
    const metadata = {};

    // Standard meta tags
    $("meta[name], meta[property]").each((_, el) => {
      const $el = $(el);
      const name = $el.attr("name") || $el.attr("property") || "";
      const content = $el.attr("content") || "";
      if (name && content) {
        metadata[name] = content;
      }
    });

    // Title
    const title = $("title").text().trim();
    if (title) metadata.title = title;

    // Canonical
    const canonical = $('link[rel="canonical"]').attr("href");
    if (canonical) metadata.canonical = canonical;

    // Language
    const lang = $("html").attr("lang");
    if (lang) metadata.language = lang;

    return metadata;
  }

  _extractVideos($) {
    const videos = [];
    $("video source, video[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src) videos.push({ src, type: $(el).attr("type") || "" });
    });

    // Iframes (YouTube, Vimeo, etc.)
    $("iframe[src]").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (/youtube|vimeo|dailymotion|wistia/.test(src)) {
        videos.push({ src, type: "embed" });
      }
    });

    return videos;
  }

  _extractAudios($) {
    const audios = [];
    $("audio source, audio[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src) audios.push({ src, type: $(el).attr("type") || "" });
    });
    return audios;
  }

  _extractHashtags(html) {
    const text = html.replace(/<[^>]*>/g, " ");
    const matches = text.match(/#[a-zA-Z]\w{1,139}/g) || [];
    return [...new Set(matches)];
  }

  _extractFavicons($) {
    const favicons = [];
    $('link[rel*="icon"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        favicons.push({
          href,
          type: $(el).attr("type") || "",
          sizes: $(el).attr("sizes") || ""
        });
      }
    });
    return favicons;
  }

  _extractMenus($) {
    const menus = [];
    $("nav, [role='navigation']").each((_, nav) => {
      const items = [];
      $(nav).find("a").each((_, a) => {
        const $a = $(a);
        items.push({
          text: $a.text().trim(),
          href: $a.attr("href") || ""
        });
      });
      if (items.length > 0) menus.push(items);
    });

    // Fallback: menu element
    $("menu").each((_, menu) => {
      const items = [];
      $(menu).find("li").each((_, li) => {
        items.push($(li).text().trim());
      });
      if (items.length > 0) menus.push(items);
    });

    return menus;
  }
}

module.exports = AutoParser;
