import { defineConfig } from "vitest/config";

// Phase 3: CesiumJS globe with a KEYLESS map stack (plan §4.1, §9.1, ADR-0003).
// Cesium's runtime assets (workers, widgets, offline Natural Earth II imagery)
// are copied into /cesium/ and served with CESIUM_BASE_URL — no ion token, no
// credentials (§6.2). Vitest still runs domain tests in node (below).
export default defineConfig({
  // Relative base: the built app works at ANY hosting path (repo root, a
  // domain root, or a GitHub Pages project subpath like /chokepoint_app/).
  // All asset references become relative; hand-written runtime paths in
  // main.ts/index.html use the same convention (see the Pages ADR note in
  // STATUS.md). Local dev and docker serve are unaffected (they serve "/").
  base: "./",
  define: {
    CESIUM_BASE_URL: JSON.stringify("./cesium/"),
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 4_000_000, // Cesium is a large single runtime by design
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/evaluation/**/*.test.ts"],
    environment: "node",
  },
});
