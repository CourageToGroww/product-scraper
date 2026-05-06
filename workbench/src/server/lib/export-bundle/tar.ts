import * as tar from "tar";
import path from "node:path";
import fs from "node:fs";

export async function packDir(dir: string): Promise<{ tarPath: string; size: number }> {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const tarPath = `${dir}.tar.gz`;
  await tar.create({ gzip: true, file: tarPath, cwd: parent }, [base]);
  const size = fs.statSync(tarPath).size;
  return { tarPath, size };
}
