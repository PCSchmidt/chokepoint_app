/**
 * Live adsb.lol wiring tests (ADR-0012): air profiles serve LIVE aircraft
 * inside the reviewed lax-cargo-approach fence; honest empty states when
 * unwired or when the fence is empty.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import { AdsbLolAdapter } from "../../src/data/adsbLolAdapter";

const NOW = "2026-09-10T14:00:00Z";
const WINDOW = { startAt: "2026-09-10T13:00:00Z", endAt: "2026-09-10T14:00:00Z" };

function payload(aircraft: Array<Record<string, unknown>>): string {
  return JSON.stringify({ ac: aircraft });
}

const FEDEX = {
  hex: "a85c01", flight: "FDX1234", r: "N638FR", t: "A21N",
  lat: 33.9, lon: -118.4, alt_baro: 8725, gs: 288.5, track: 167.79,
  type: "adsb_icao", seen_pos: 0.4,
};
const OUTSIDE = {
  hex: "aaaaaa", flight: "FDX2222", r: "N222AA", t: "A21N",
  lat: 34.5, lon: -117.5, // far outside the fence
  alt_baro: 30000, gs: 400, track: 90,
  type: "adsb_icao", seen_pos: 1,
};
const PASSENGER = {
  hex: "a437ce", flight: "DAL1112", r: "N371DA", t: "B738",
  lat: 33.92, lon: -118.39,
  alt_baro: 5000, gs: 200, track: 250,
  type: "adsb_icao", seen_pos: 0.2,
};

const okFetch = (body: string) => async () => ({ status: 200, ok: true, text: async () => body });


describe("live adsb wiring (ADR-0012)", () => {
  it("air profile serves LIVE aircraft inside the reviewed fence, counts them, marks cohorts inferred", async () => {
    const adsb = new AdsbLolAdapter({ center: { latitude: 33.9, longitude: -118.4 }, radiusNm: 15, fetchFn: okFetch(payload([FEDEX, PASSENGER, OUTSIDE])), nowFn: () => NOW });
    const manager = await createDataManager({ mode: "fixture", adsbAdapter: adsb, nowFn: () => NOW });
    const snap = manager.getSnapshot("lax-cargo-air", WINDOW);
    // Only the in-fence aircraft survive; the far-away one is excluded.
    expect(snap.observations).toHaveLength(2);
    expect(snap.metrics.vesselCount.value).toBe(2);
    expect(snap.metrics.vesselCount.formulaVersion).toBe("aircraft-count-v1-adsb");
    expect(snap.metrics.vesselCount.quality.state).toBe("fresh");
    // Freight cohort (inferred FDX) separated from non-freight:
    expect(snap.freightEntityIds).toEqual(["aircraft:a85c01"]);
    expect(snap.unclassifiedCount).toBe(1);
    expect(snap.health.adsb).not.toBeNull();
    expect(snap.multimodalNotice).toBeNull(); // data present: no notice needed
    manager.destroy();
  });

  it("unwired adapter: honest no-data notice, no fabricated counts", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    const snap = manager.getSnapshot("lax-cargo-air", WINDOW);
    expect(snap.observations).toHaveLength(0);
    expect(snap.metrics.vesselCount.value).toBeNull();
    expect(snap.metrics.vesselCount.quality.coverageNote).toMatch(/not wired/);
    expect(snap.multimodalNotice).toMatch(/not wired/);
    manager.destroy();
  });

  it("wired but empty sky: honest coverage note (never zero-as-data)", async () => {
    const adsb = new AdsbLolAdapter({ center: { latitude: 33.9, longitude: -118.4 }, radiusNm: 15, fetchFn: okFetch(payload([])), nowFn: () => NOW });
    const manager = await createDataManager({ mode: "fixture", adsbAdapter: adsb, nowFn: () => NOW });
    const snap = manager.getSnapshot("lax-cargo-air", WINDOW);
    expect(snap.observations).toHaveLength(0);
    expect(snap.metrics.vesselCount.value).toBeNull();
    expect(snap.multimodalNotice).toMatch(/no aircraft were inside/i);
    manager.destroy();
  });
});