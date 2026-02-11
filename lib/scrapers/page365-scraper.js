const axios = require("axios");
const { Parser } = require("json2csv");
const fs = require("fs");
const path = require("path");

const HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

class Page365Scraper {
  constructor({ baseUrl, outputName, downloadImages = true, outputBase = "./output" }) {
    this.baseUrl = baseUrl.replace(/\/?$/, "");
    this.outputName = outputName;
    this.downloadImages = downloadImages;
    this.outputDir = path.join(outputBase, outputName);
    this.assetsDir = path.join(this.outputDir, "images");
    this.origin = new URL(this.baseUrl).origin;
  }

  async scrapeAll() {
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }

    // 1. Fetch categories
    console.log("\n--- Fetching categories ---");
    const categories = await this._getAllCategories();

    // 2. Fetch product listings by category
    console.log("\n--- Fetching product listings by category ---");
    const listings = await this._getAllProducts(categories);

    // 3. Fetch details + download images
    console.log(`\n--- Fetching details for ${listings.length} products ---`);
    const fullProducts = [];
    const allVariantRows = [];
    const productCsvRows = [];
    let totalImages = 0;

    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      const handle = this._makeHandle(listing.name);
      console.log(`[${i + 1}/${listings.length}] ${listing.name} (${handle})...`);

      const detail = await this._getProductDetail(listing.id);
      await new Promise(r => setTimeout(r, 150));

      const product = detail || listing;
      const imageUrls = this._extractImageUrls(product);
      let downloaded = [];

      if (this.downloadImages && imageUrls.length > 0) {
        console.log(`  Downloading ${imageUrls.length} image(s)...`);
        downloaded = await this._downloadProductImages(imageUrls, handle);
        totalImages += downloaded.length;
      }

      product._localImages = downloaded.map(d => d.localPath);
      product._handle = handle;
      fullProducts.push(product);

      const variants = product.variants || [];
      const review = product.review || {};

      productCsvRows.push({
        id: product.id,
        name: product.name || "",
        description: (product.description || "").replace(/\n/g, "\\n"),
        price: product.price || "",
        full_price: product.full_price || "",
        enabled: product.enabled,
        stockable: product.stockable,
        when_out_of_stock: product.when_out_of_stock || "",
        category_id: product.category?.id || "",
        category_name: product.category?.name || "",
        photo_small: product.photo?.small || "",
        photo_normal: product.photo?.normal || "",
        all_image_urls: imageUrls.join("|"),
        local_images: downloaded.map(d => d.localPath).join("|"),
        variant_count: variants.length,
        review_mean: review.mean || "",
        review_count: review.count || 0
      });

      for (const v of variants) {
        allVariantRows.push({
          product_id: product.id,
          product_name: product.name || "",
          variant_id: v.id,
          variant_name: v.name || "",
          variant_price: v.price || "",
          variant_full_price: v.full_price || "",
          in_stock: v.in_stock,
          available: v.available || 0
        });
      }
    }

    // 4. Write outputs
    console.log("\n--- Writing output files ---");
    this._writeOutputs(fullProducts, productCsvRows, allVariantRows, categories);

    console.log(`\nDone!`);
    console.log(`  Products: ${fullProducts.length}`);
    console.log(`  Variants: ${allVariantRows.length}`);
    console.log(`  Categories: ${categories.length}`);
    console.log(`  Images downloaded: ${totalImages}`);
    console.log(`\nAll output saved to: ${this.outputDir}/`);

    return { products: fullProducts, variants: allVariantRows, categories, totalImages };
  }

  // --- API Methods ---

  async _getAllCategories() {
    const categories = [];
    let page = 1;
    while (true) {
      const resp = await axios.get(`${this.origin}/categories?page=${page}`, {
        headers: HEADERS, timeout: 30000
      });
      if (!resp.data.items || resp.data.items.length === 0) break;
      categories.push(...resp.data.items);
      if (categories.length >= resp.data.count) break;
      page++;
    }
    console.log(`Fetched ${categories.length} categories`);
    return categories;
  }

  async _getCategoryProducts(categoryId, categoryName) {
    const url = `${this.origin}/categories/${categoryId}/products?page=1`;
    const countResp = await axios.get(url, { headers: HEADERS, timeout: 30000 });
    const totalCount = countResp.data.count || 0;
    if (totalCount === 0) return [];

    const perPage = 16;
    const pageNum = Math.ceil(totalCount / perPage);
    const fullUrl = `${this.origin}/categories/${categoryId}/products?page=${pageNum}`;
    const resp = await axios.get(fullUrl, { headers: HEADERS, timeout: 120000 });
    console.log(`  ${categoryName}: ${resp.data.items.length} products`);
    return resp.data.items;
  }

  async _getAllProducts(categories) {
    const seenIds = new Set();
    const allProducts = [];

    for (const cat of categories) {
      if (cat.products_count === 0) continue;
      try {
        const products = await this._getCategoryProducts(cat.id, cat.name);
        for (const p of products) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allProducts.push(p);
          }
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`  Failed to fetch category ${cat.name}: ${err.message}`);
      }
    }

    // Fallback for uncategorized products
    try {
      const mainResp = await axios.get(`${this.origin}/products?page=1`, {
        headers: HEADERS, timeout: 30000
      });
      const mainCount = mainResp.data.count || 0;
      if (mainCount > allProducts.length) {
        console.log(`  Main listing has ${mainCount} total, found ${allProducts.length} via categories`);
        const perPage = 16;
        const safePage = Math.min(Math.ceil(mainCount / perPage), 75);
        const resp = await axios.get(`${this.origin}/products?page=${safePage}`, {
          headers: HEADERS, timeout: 120000
        });
        for (const p of resp.data.items) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allProducts.push(p);
          }
        }
      }
    } catch (err) {
      console.error(`  Failed fallback fetch: ${err.message}`);
    }

    console.log(`Total unique products: ${allProducts.length}`);
    return allProducts;
  }

  async _getProductDetail(productId) {
    try {
      const resp = await axios.get(`${this.origin}/products/${productId}`, {
        headers: HEADERS, timeout: 30000
      });
      return resp.data;
    } catch (err) {
      console.error(`  Failed to fetch product ${productId}: ${err.message}`);
      return null;
    }
  }

  // --- Image Methods ---

  _extractImageUrls(detail) {
    const urls = [];
    if (detail.photos && Array.isArray(detail.photos)) {
      const sorted = [...detail.photos].sort((a, b) => (a.position || 0) - (b.position || 0));
      for (const photo of sorted) {
        const url = photo.normal || photo.original || photo.large || photo.thumb_url;
        if (url && url.startsWith("http")) urls.push(url);
      }
    }
    if (urls.length === 0 && detail.photo) {
      const url = detail.photo.normal || detail.photo.original;
      if (url && url.startsWith("http")) urls.push(url);
    }
    return urls;
  }

  async _downloadProductImages(imageUrls, handle) {
    const productDir = path.join(this.assetsDir, handle);
    if (!fs.existsSync(productDir)) {
      fs.mkdirSync(productDir, { recursive: true });
    }

    const results = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const resp = await axios.get(imageUrls[i], {
          responseType: "arraybuffer",
          headers: { "User-Agent": HEADERS["User-Agent"] },
          timeout: 30000
        });
        const contentType = resp.headers["content-type"] || "";
        let ext = ".jpg";
        if (contentType.includes("png")) ext = ".png";
        else if (contentType.includes("webp")) ext = ".webp";
        else if (contentType.includes("gif")) ext = ".gif";

        const filename = `${handle}_${i + 1}${ext}`;
        fs.writeFileSync(path.join(productDir, filename), resp.data);
        results.push({ localPath: `${handle}/${filename}`, remoteUrl: imageUrls[i], position: i + 1 });
      } catch (err) {
        console.error(`  Failed to download image: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return results;
  }

  // --- Output Methods ---

  _writeOutputs(products, productCsvRows, variantRows, categories) {
    // Full JSON
    const fullData = {
      scraped_at: new Date().toISOString(),
      store_url: this.baseUrl,
      total_products: products.length,
      total_categories: categories.length,
      categories,
      products
    };
    const jsonPath = path.join(this.outputDir, `${this.outputName}-full.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(fullData, null, 2));
    console.log(`  ${jsonPath} (${(fs.statSync(jsonPath).size / 1024 / 1024).toFixed(1)} MB)`);

    // Products CSV
    const productFields = [
      "id", "name", "description", "price", "full_price", "enabled", "stockable",
      "when_out_of_stock", "category_id", "category_name", "photo_small", "photo_normal",
      "all_image_urls", "local_images", "variant_count", "review_mean", "review_count"
    ];
    const productCsv = new Parser({ fields: productFields }).parse(productCsvRows);
    const productCsvPath = path.join(this.outputDir, `${this.outputName}-products.csv`);
    fs.writeFileSync(productCsvPath, productCsv);
    console.log(`  ${productCsvPath} (${productCsvRows.length} rows)`);

    // Variants CSV
    const variantFields = [
      "product_id", "product_name", "variant_id", "variant_name",
      "variant_price", "variant_full_price", "in_stock", "available"
    ];
    const variantCsv = new Parser({ fields: variantFields }).parse(variantRows);
    const variantCsvPath = path.join(this.outputDir, `${this.outputName}-variants.csv`);
    fs.writeFileSync(variantCsvPath, variantCsv);
    console.log(`  ${variantCsvPath} (${variantRows.length} rows)`);

    // Categories CSV
    const catFields = ["id", "name", "description", "products_count", "updated_at"];
    const catCsv = new Parser({ fields: catFields }).parse(categories);
    const catCsvPath = path.join(this.outputDir, `${this.outputName}-categories.csv`);
    fs.writeFileSync(catCsvPath, catCsv);
    console.log(`  ${catCsvPath} (${categories.length} rows)`);
  }

  _makeHandle(name) {
    return (name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
}

module.exports = Page365Scraper;
