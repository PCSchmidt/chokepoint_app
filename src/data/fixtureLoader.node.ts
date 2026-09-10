/**
 * Node-side fixture FILE loading (CHOKEPOINT-PLAN.md §12.2). Browser code must
 * NOT import this module — it uses node:fs. The browser receives the same
 * manifests through import.meta.glob (see src/main.ts and manager.ts).
 */

import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import { parseFixture } from "./fixtureLoader";
import type { LoadedFixture, FixtureDirectoryResult } from "./fixtureLoader";

/** Load a single fixture file from disk (node only). */
export async function loadFixtureFile(filePath: string): Promise<LoadedFixture> {
  const text = await readFile(filePath, "utf-8");
  return parseFixture(JSON.parse(text));
}

/** Load every *.json fixture in a directory (node/tests only). */
export async function loadFixtureDirectory(dirPath: string): Promise<FixtureDirectoryResult> {
  const files = (await readdir(dirPath)).filter((f) => f.endsWith(".json")).sort();
  const fixtures: LoadedFixture[] = [];
  for (const file of files) {
    fixtures.push(await loadFixtureFile(path.join(dirPath, file)));
  }
  return { fixtures, files };
}
