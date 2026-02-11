const axios = require("axios");
const fs = require("fs");
const path = require("path");

class ImageDownloader {
  constructor({ userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", delay = 100 } = {}) {
    this.userAgent = userAgent;
    this.delay = delay;
  }

  async downloadOne(url, filepath) {
    if (!url || !url.startsWith("http")) return null;

    const resp = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { "User-Agent": this.userAgent },
      timeout: 30000
    });

    const contentType = resp.headers["content-type"] || "";
    let ext = ".jpg";
    if (contentType.includes("png")) ext = ".png";
    else if (contentType.includes("webp")) ext = ".webp";
    else if (contentType.includes("gif")) ext = ".gif";
    else if (contentType.includes("svg")) ext = ".svg";

    const finalPath = filepath.endsWith(ext) ? filepath : filepath + ext;
    fs.writeFileSync(finalPath, resp.data);
    return { filename: path.basename(finalPath), size: resp.data.length };
  }

  async downloadAll(imageUrls, outputDir, namePrefix = "image") {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const results = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const filepath = path.join(outputDir, `${namePrefix}_${i + 1}`);
      try {
        const result = await this.downloadOne(url, filepath);
        if (result) {
          results.push({
            localPath: path.join(path.basename(outputDir), result.filename),
            remoteUrl: url,
            position: i + 1,
            size: result.size
          });
        }
      } catch (err) {
        results.push({ remoteUrl: url, position: i + 1, error: err.message });
      }
      if (this.delay > 0) await new Promise(r => setTimeout(r, this.delay));
    }
    return results;
  }
}

module.exports = ImageDownloader;
