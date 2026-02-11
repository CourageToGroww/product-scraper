import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".scrapekit");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  outputDir: "./output",
  concurrency: 3,
  delay: 200,
  timeout: 30000,
  retry: 3,
  defaultOutput: "json",
  proxyFile: "",
  captchaKey: "",
  rotateUa: false,
  stealth: false
};

export function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted config, use defaults
  }
  return { ...DEFAULTS };
}

export function save(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const tmpPath = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, CONFIG_FILE);
}

export function get(key) {
  const config = load();
  return config[key];
}

export function set(key, value) {
  const config = load();
  config[key] = value;
  save(config);
}
