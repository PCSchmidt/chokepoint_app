/**
 * AISStream connectivity smoke test (run LOCALLY, never in CI — it uses a real
 * credential and a real network connection).
 *
 * Usage:
 *   AISSTREAM_API_KEY=<your key> npm run smoke
 *
 * Behavior:
 *  - Connects to wss://stream.aisstream.io/v0/stream, subscribes to bounding
 *    boxes derived from the reviewed chokepoint fences (ADR-0011), and reports
 *    accepted/rejected/unsupported counts plus per-chokepoint candidate hits
 *    for a bounded window (default 60s).
 *  - The key is read from the environment, used only in the subscription
 *    payload, never logged, never written to disk (§14.1, ADR-0010).
 *  - Exit code 0 on a clean close; 1 on failures.
 */

import { readFileSync } from "node:fs";
import { AisStreamAdapter, boundingBoxesFromFences } from "../src/data/aisStreamAdapter";
import { toReviewedGeofence } from "../src/data/geofences";
import { CHOKEPOINT_REGISTRY } from "../src/config/chokepoints";
import type { TransportObservation } from "../src/data/observation";

let key = process.env["AISSTREAM_API_KEY"];
if (!key || key.trim() === "") {
  // Local convenience: read a gitignored .env in the repo root (server-side
  // only, §14.1). The key is never printed, logged, or written anywhere.
  try {
    const envText = readFileSync(".env", "utf-8");
    for (const line of envText.split("\n")) {
      const m = /^\s*AISSTREAM_API_KEY\s*=\s*(.+)\s*$/.exec(line);
      if (m) key = m[1]!.trim();
    }
  } catch {
    // no .env file; fall through to the error below
  }
}
if (!key || key.trim() === "") {
  console.error("AISSTREAM_API_KEY is not set (env or .env). Export it (server-side only) and re-run.");
  process.exit(1);
}

const durationSeconds = Number(process.env["SMOKE_SECONDS"] ?? 60);
const fences = CHOKEPOINT_REGISTRY.flatMap((c) => c.geofences).map(toReviewedGeofence);

const buffer: TransportObservation[] = [];
const adapter = new AisStreamAdapter({
  apiKey: key,
  fences,
  nowFn: () => new Date().toISOString(),
  maxRecords: 20000,
  // The adapter stores into its own buffer; we mirror locally via getRecords at the end.
});

// Tap the adapter's records by polling getRecords during the window.
const startIso = new Date().toISOString();
await adapter.enable({ now: startIso, trigger: "manual" });
const status = adapter.getStatus();
console.log("enable status:", status.state, status.detail ?? "");
if (status.state === "UNAVAILABLE" && adapter.isKeyless) {
  console.error("adapter reports missing key; check the environment variable name.");
  process.exit(1);
}

console.log(
  `subscribing with ${boundingBoxesFromFences(fences).length} bounding box(es) for ${durationSeconds}s...`
);

const poll = setInterval(() => {
  const records = adapter.getRecords();
  buffer.length = 0;
  buffer.push(...records);
}, 2000);

await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
clearInterval(poll);

// Read records BEFORE disabling: getRecords() honestly serves nothing after
// disable() (a Phase 1 contract), so reading first is required to count.
const records = adapter.getRecords();
await adapter.disable();
const diagnostics = adapter.getDiagnostics();
console.log("--- smoke results ---");
console.log(JSON.stringify(diagnostics, null, 2));
const byFence = new Map<string, number>();
for (const fence of fences) {
  // Cheap candidate-membership count: points inside each fence's bbox.
  const lats = fence.polygon.map((v) => v[0]);
  const lons = fence.polygon.map((v) => v[1]);
  const inBox = records.filter((o) => {
    const lat = o.position.latitude;
    const lon = o.position.longitude;
    return (
      lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
      lon >= Math.min(...lons) && lon <= Math.max(...lons)
    );
  });
  byFence.set(fence.id, inBox.length);
}
console.log("candidate records per fence bbox:", Object.fromEntries(byFence));
const classified = records.filter((o) => o.quality.classification === "confirmed");
const freight = records.filter((o) => ["cargo_vessel", "tanker"].includes(o.entityType));
console.log(`total accepted: ${records.length}; classified: ${classified.length}; freight-classified: ${freight.length}`);
console.log("NOTE: coverage counts from a short smoke window are NOT coverage statistics; run longer windows for §6.1 coverage evidence.");
console.log("No key material was logged or written. Raw frames were parsed and discarded (ADR-0010).");
