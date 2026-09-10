import { defineConfig } from "vitest/config";

// Phase 3: CesiumJS globe with a KEYLESS map stack (plan §4.1, §9.1, ADR-0003).
// Cesium's runtime assets (workers, widgets, offline Natural Earth II imagery)
// are copied into /cesium/ and served with CESIUM_BASE_URL — no ion token, no
// credentials (§6.2). Vitest still runs domain tests in node (below).
export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesium/"),
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
