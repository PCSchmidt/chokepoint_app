/**
 * Multimodal snapshot tests (ADR-0013/0015): land profiles serve facility
 * metrics keyed by facilityId; air profiles serve an honest empty state;
 * neither runs entity metrics while geometry is placeholder.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import { facilityCards } from "../../src/ui/freightHud";

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

  it("facility HUD cards render commercial wait with SIM badge in fixture mode (§4.2)", async () => {
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    const cards = facilityCards(snap, false); // fixture mode: CBP layer unwired
    expect(cards).toHaveLength(2);
    const bota = cards.find((c) => c.id === "facility-cbp:240201:bridge")!;
    expect(bota.value).toBe("3 min");
    expect(bota.badge).toBe("SIM"); // never reads as live in fixture mode
    // DOM render of facility cards is covered in the happy-dom agentPanel/phase3-ui suites.
  });

  it("facility cards show LIVE when the CBP layer is wired, UNKNOWN when no reading", () => {
    const snap = manager.getSnapshot("el-paso-border-crossings", WINDOW);
    const wired = facilityCards(snap, true);
    expect(wired.every((c) => c.badge === "LIVE")).toBe(true);
    // A null-value facility renders UNKNOWN with an honest note (never zero).
    const snapNoReadings = { ...snap, facilityMetrics: [{ ...snap.facilityMetrics[0]!, measurements: [{ laneGroup: "commercial_vehicle" as const, metric: "wait_minutes" as const, value: null, unit: "minutes" as const }] }] };
    const cards = facilityCards(snapNoReadings, true);
    expect(cards[0]!.badge).toBe("UNKNOWN");
    expect(cards[0]!.value).toBe("—");
    expect(cards[0]!.note).toMatch(/missing is not zero/);
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
