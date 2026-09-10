/**
 * Production server entry (§16.1): serves the built app (dist/) plus the
 * §10.3 API and /metrics. Fixture mode; no credentials required.
 *
 * Command: npm run build && npm run serve
 * Port: PORT env var (default 8787).
 */

import { startServer } from "../src/server/server";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}
const app = await startServer({ port, staticDir: "dist" });
console.log(`chokepoint serving on http://localhost:${app.port} (fixture mode)`);
