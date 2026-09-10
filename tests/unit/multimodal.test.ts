/**
 * Multimodal snapshot tests (ADR-0013/0015): land profiles serve facility
 * metrics keyed by facilityId; air profiles serve an honest empty state;
 * neither runs entity metrics while geometry is placeholder.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";

const WINDOW = { startAt: "2026-09-10T07:00:00Z", endAt: "2026-09-10T12:00:00Z" };

describe("land profile: CBP facility metrics (ADR-0013/0015)", async () => {
  const manager = await createDataManager({ mode: "fixture" });

  it("serves facility readings keyed by facilityId, no membership involved", async () => {
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    expect(snap.facilityMetrics.length).toBeGreaterThanOrEqual(2);
    for (const f of snap.facilityMetrics) {
      expect(f.facilityId).toMatch(/^cbp:/);
      expect(f.mode).toBe("land");
    }
    const bota = snap.facilityMetrics.find((f) => f.facilityId === "cbp:240201:bridge");
    expect(bota).toBeDefined();
    const wait = bota!.measurements.find((x) => x.laneGroup === "commercial_vehicle" && x.metric === "wait_minutes");
    expect(wait?.value).toBe(3); // real-sample value, SIMULATED provenance
  });

  it("entity metrics are UNKNOWN with the facility-profile note, never zero", () => {
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    expect(snap.metrics.vesselCount.value).toBeNull();
    expect(snap.metrics.vesselCount.quality.coverageNote).toMatch(/facility profile/);
    expect(snap.comparisons.vesselCount.direction).toBe("unknown");
    expect(snap.observations).toHaveLength(0); // facility profile: no entity data
  });

  it("facility data NEVER bleeds into entity observations (§3.1, ADR-0015)", () => {
    for (const id of ["long-beach-approach", "singapore-malacca-approach", "suez-canal-approaches"]) {
      const maritime = manager.getSnapshot(id, WINDOW);
      expect(maritime.facilityMetrics).toEqual([]);
    }
    const land = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    expect(land.observations).toEqual([]);
  });
});

describe("air profile: honest empty state until geometry review (ADR-0012)", async () => {
  const manager = await createDataManager({ mode: "fixture" });

  it("serves no aircraft data with a truthful notice (never a fake view)", () => {
    const snap = manager.getSnapshot("lax-cargo-air", WINDOW);
    expect(snap.observations).toHaveLength(0);
    expect(snap.facilityMetrics).toHaveLength(0);
    expect(snap.metrics.vesselCount.value).toBeNull();
    expect(snap.metrics.vesselCount.quality.state).toBe("unknown");
  });

  it("multimodalNotice states the honest no-data reason (geometry approved, adapter unwired)", () => {
    const snap = manager.getSnapshot("lax-cargo-air", WINDOW);
    expect(snap.multimodalNotice).toMatch(/not wired|no aircraft/i);
    expect(snap.metrics.vesselCount.value).toBeNull();
  });
});
