/**
 * Live CBP wiring tests (ADR-0013): the keyless facility layer can serve LIVE
 * readings in both modes; fallback to SIMULATED fixtures is honest; maritime
 * snapshots are untouched.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createDataManager } from "../../src/data/manager";
import { CbpWaitTimesAdapter, type FetchLike } from "../../src/data/cbpWaitTimesAdapter";

const REAL_SAMPLE = readFileSync("research/sources/raw/cbp-bwt-sample-2026-09-10.json", "utf-8");
const NOW = "2026-09-10T13:00:00Z";
const WINDOW = { startAt: "2026-09-10T07:00:00Z", endAt: "2026-09-10T12:00:00Z" };

const liveFetch: FetchLike = async () => ({ status: 200, ok: true, text: async () => REAL_SAMPLE });

describe("live CBP wiring (ADR-0013)", () => {
  it("land profiles serve LIVE facility metrics when the adapter is wired", async () => {
    const cbp = new CbpWaitTimesAdapter({ fetchFn: liveFetch, nowFn: () => NOW, portNumbers: ["240201", "240203"] });
    const manager = await createDataManager({ mode: "fixture", cbpAdapter: cbp });
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    expect(snap.facilityMetrics.length).toBeGreaterThanOrEqual(2);
    // LIVE provenance: the provider is the adapter, not the simulated fixture.
    for (const f of snap.facilityMetrics) {
      expect(f.source.providerId).toBe("cbp-bwt");
    }
    expect(snap.health.cbp).not.toBeNull();
    manager.destroy();
  });

  it("facility metrics are LATEST-per-facility from the live layer", async () => {
    const cbp = new CbpWaitTimesAdapter({ fetchFn: liveFetch, nowFn: () => NOW, portNumbers: ["240201", "240203"] });
    const manager = await createDataManager({ mode: "fixture", cbpAdapter: cbp });
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    const ids = snap.facilityMetrics.map((f) => f.facilityId).sort();
    expect(ids).toEqual(["cbp:240201:bridge", "cbp:240203:ysleta"]);
    manager.destroy();
  });

  it("without the adapter, land falls back to SIMULATED fixtures (keyless-first §6.2)", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    expect(snap.facilityMetrics.length).toBeGreaterThanOrEqual(2);
    for (const f of snap.facilityMetrics) {
      expect(f.source.providerId).toBe("cbp-bwt"); // fixture records use the same provider vocabulary
      expect(f.metricId).toMatch(/^sim-facility:/); // ...but simulated ids
    }
    expect(snap.health.cbp).toBeNull(); // no live layer wired — honest
    manager.destroy();
  });

  it("maritime snapshots carry no CBP data even when the adapter is wired (§3.1)", async () => {
    const cbp = new CbpWaitTimesAdapter({ fetchFn: liveFetch, nowFn: () => NOW });
    const manager = await createDataManager({ mode: "fixture", cbpAdapter: cbp });
    const snap = manager.getSnapshot("long-beach-approach", { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" });
    expect(snap.facilityMetrics).toEqual([]);
    manager.destroy();
  });
});
