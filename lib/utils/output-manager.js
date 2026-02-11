const fs = require("fs");
const path = require("path");

class OutputManager {
  constructor(baseDir = "./output") {
    this.baseDir = baseDir;
  }

  getOutputDir(name) {
    return path.join(this.baseDir, name);
  }

  ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
  }

  writeFile(outputDir, filename, content) {
    this.ensureDir(outputDir);
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, content);
    const size = fs.statSync(filepath).size;
    return { filepath, size };
  }

  writeJSON(outputDir, filename, data) {
    return this.writeFile(outputDir, filename, JSON.stringify(data, null, 2));
  }

  writeBinary(outputDir, filename, buffer) {
    this.ensureDir(outputDir);
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, buffer);
    return { filepath, size: buffer.length };
  }

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}

module.exports = OutputManager;
