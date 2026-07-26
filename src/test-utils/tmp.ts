import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Creates a fresh temporary directory for a test file to write into.
 * Returns the directory path plus a cleanup function that must be
 * called (e.g. in afterEach) to remove it.
 */
export function makeTmpDir(prefix = "axigen-test-"): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Writes `content` to `relativePath` inside `dir`, creating parent folders as needed. */
export function writeFile(dir: string, relativePath: string, content: string): string {
  const full = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return full;
}
