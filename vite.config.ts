import { defineConfig } from "vite";
import { defineConfig as defineTestConfig } from "vitest/config";

// Phase 1: fixture-mode only. No provider credentials, no CesiumJS yet (Phase 3).
export default defineConfig({
  ...defineTestConfig({
    test: {
      include: ["tests/unit/**/*.test.ts"],
      environment: "node",
    },
  }),
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
