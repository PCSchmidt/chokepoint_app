/**
 * Sync Cesium runtime assets into public/cesium/ so they are served in BOTH
 * `vite dev` and `vite build` (public/ is served as-is in dev and copied to
 * dist verbatim). Content is gitignored — node_modules is the source of truth.
 * Keyless: these are Cesium's bundled offline assets (no ion, no credentials).
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = path.join(root, "public", "cesium");

const dirs = ["Workers", "ThirdParty", "Assets", "Widgets"];
for (const dir of dirs) {
  if (!existsSync(path.join(src, dir))) {
    console.error(`missing Cesium asset directory: ${dir} — run npm install`);
    process.exit(1);
  }
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of dirs) {
  cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
console.log("synced Cesium runtime assets to public/cesium");
