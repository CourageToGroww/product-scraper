const { Parser } = require("json2csv");
const OutputManager = require("../utils/output-manager");

class CsvOutput {
  constructor(outputManager) {
    this.om = outputManager || new OutputManager();
  }

  write(data, outputDir, filename = "data.csv") {
    // Flatten nested objects for CSV
    const rows = Array.isArray(data) ? data : [data];
    const flattened = rows.map(row => this._flatten(row));

    if (flattened.length === 0) {
      const result = this.om.writeFile(outputDir, filename, "");
      return { format: "csv", rows: 0, ...result };
    }

    const fields = Object.keys(flattened[0]);
    const parser = new Parser({ fields });
    const csv = parser.parse(flattened);
    const result = this.om.writeFile(outputDir, filename, csv);
    return { format: "csv", rows: flattened.length, ...result };
  }

  _flatten(obj, prefix = "") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${key}` : key;

      if (Array.isArray(value)) {
        result[fullKey] = value.map(v =>
          typeof v === "object" ? JSON.stringify(v) : String(v)
        ).join("|");
      } else if (value && typeof value === "object") {
        Object.assign(result, this._flatten(value, fullKey));
      } else {
        result[fullKey] = value;
      }
    }
    return result;
  }
}

module.exports = CsvOutput;
