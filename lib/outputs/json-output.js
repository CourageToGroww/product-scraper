const OutputManager = require("../utils/output-manager");

class JsonOutput {
  constructor(outputManager) {
    this.om = outputManager || new OutputManager();
  }

  write(data, outputDir, filename = "data.json") {
    const result = this.om.writeJSON(outputDir, filename, data);
    return { format: "json", ...result };
  }
}

module.exports = JsonOutput;
