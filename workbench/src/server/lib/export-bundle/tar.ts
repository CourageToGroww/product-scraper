import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export function packDir(dir: string): { tarPath: string; size: number } {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const tarPath = `${dir}.tar.gz`;
  execSync(`tar -C "${parent}" -czf "${tarPath}" "${base}"`);
  const size = fs.statSync(tarPath).size;
  return { tarPath, size };
}
