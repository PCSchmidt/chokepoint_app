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
  // Fixed dev port, not Vite's default 5173: that default is also the port other
  // local Vite projects (e.g. sitework-ai's dashboard) publish, and without
  // strictPort Vite silently hops to the next free port, so which app lands where
  // depended on start order. strictPort fails loudly instead. The QA and perf
  // harnesses pin their own ports (4173, 4174); `npm run serve` uses 8787.
  server: { port: 5174, strictPort: true },
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
