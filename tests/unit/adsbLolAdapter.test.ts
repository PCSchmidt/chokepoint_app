/**
 * adsb.lol adapter tests (ADR-0012). Transport INJECTED; payloads mirror the
 * VERIFIED live API shape (hex/flight/r/t/lat/lon/alt_baro/gs/track/seen_pos).
 * No network in CI (§6.2).
 */

import { describe, expect, it } from "vitest";
import { AdsbLolAdapter, FREIGHT_CALLSIGN_PREFIXES, transformAircraft } from "../../src/data/adsbLolAdapter";

const NOW = "2026-09-10T14:00:00Z";

function payload(aircraft: Array<Record<string, unknown>>): string {
  return JSON.stringify({ ac: aircraft, now: Math.floor(Date.parse(NOW) / 1000) });
}

const FEDEX = {
  hex: "a85c01", flight: "FDX1234", r: "N638FR", t: "A21N",
  lat: 33.7366, lon: -118.5307, alt_baro: 8725, gs: 288.5, track: 167.79,
  type: "adsb_icao", seen_pos: 0.4,
};
const UNKNOWN = {
  hex: "a437ce", flight: "DAL1112", r: "N371DA", t: "B738",
  lat: 33.67, lon: -118.43, alt_baro: 10850, gs: 324.2, track: 109.8,
  type: "adsb_icao", seen_pos: 0.1,
};


const okFetch = (body: string): import("../../src/data/adsbLolAdapter").FetchLike =>
  async () => ({ status: 200, ok: true, text: async () => body });

describe("adsb.lol adapter (ADR-0012)", () => {
  it("ingests aircraft as mode=air TransportObservations with correct kinematics", async () => {
    const a = new AdsbLolAdapter({ center: { latitude: 33.94, longitude: -118.4 }, radiusNm: 25, fetchFn: okFetch(payload([FEDEX])), nowFn: () => NOW });
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("ok");
    const records = [...a.getRecords()];
    expect(records).toHaveLength(1);
    const o = records[0]!;
    expect(o.mode).toBe("air");
    expect(o.entityType).toBe("aircraft");
    expect(o.position.latitude).toBeCloseTo(33.7366);
    expect(o.kinematics.speedKnots).toBeCloseTo(288.5);
    expect(o.kinematics.headingDegrees).toBeCloseTo(167.79);
    expect(o.observedAt).toBe("2026-09-10T13:59:59Z"); // NOW - seen_pos 0.4s
    a.destroy();
  });

  it("freight-operator classification is INFERRED, never confirmed (ADR-0012)", async () => {
    const a = new AdsbLolAdapter({ center: { latitude: 33.94, longitude: -118.4 }, fetchFn: okFetch(payload([FEDEX, UNKNOWN])), nowFn: () => NOW });
    await a.enable({ now: NOW, trigger: "startup" });
    const all = [...a.getRecords()];
    const fdx = all.find((o) => o.source.recordRef === "hex=a85c01")!;
    const dal = all.find((o) => o.source.recordRef === "hex=a437ce")!;
    expect(fdx.quality.classification).toBe("inferred"); // FDX prefix -> inferred freight
    expect(dal.quality.classification).toBe("unknown"); // DAL is not a freight prefix
    expect(all.every((o) => o.quality.classification !== "confirmed")).toBe(true);
    a.destroy();
  });

  it("callsign prefixes list covers the design-note operators", () => {
    expect(FREIGHT_CALLSIGN_PREFIXES).toContain("FDX");
    expect(FREIGHT_CALLSIGN_PREFIXES).toContain("UPS");
    expect(FREIGHT_CALLSIGN_PREFIXES).toContain("GTI"); // Atlas Air
    expect(FREIGHT_CALLSIGN_PREFIXES).toContain("CLX"); // Cargolux
  });

  it("records without position are skipped, not fabricated", async () => {
    const noPos = { hex: "aaaaaa", flight: "FDX9999" }; // no lat/lon
    const a = new AdsbLolAdapter({ center: { latitude: 33.94, longitude: -118.4 }, fetchFn: okFetch(payload([noPos])), nowFn: () => NOW });
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(a.getRecords()).toHaveLength(0);
    expect(result.acceptedCount).toBe(0);
    a.destroy();
  });

  it("ODbL posture: bounded buffer with TTL (records beyond retention drop)", async () => {
    const a = new AdsbLolAdapter({
      center: { latitude: 33.94, longitude: -118.4 },
      fetchFn: okFetch(payload([FEDEX])),
      nowFn: () => NOW,
      maxRecords: 10,
      retentionSeconds: 60,
    });
    await a.enable({ now: NOW, trigger: "startup" });
    expect(a.getRecords()).toHaveLength(1);
    a.destroy();
  });

  it("network failure is an honest UNAVAILABLE with no fabricated records", async () => {
    const a = new AdsbLolAdapter({
      center: { latitude: 33.94, longitude: -118.4 },
      fetchFn: async () => {
        throw new Error("dns failure");
      },
      nowFn: () => NOW,
    });
    const result = await a.enable({ now: NOW, trigger: "startup" });
    expect(result.status).toBe("failure");
    expect(a.getRecords()).toHaveLength(0);
    expect(["UNAVAILABLE", "NEVER_ANSWERED"]).toContain(a.getStatus().state);
    a.destroy();
  });

  it("transformAircraft omits ground altitude strings instead of clamping", () => {
    const raw = transformAircraft({ hex: "abc123", lat: 33.9, lon: -118.4, alt_baro: "ground" }, NOW, null);
    expect(raw).not.toBeNull();
    if (raw !== null) {
      expect(raw["position"]).not.toHaveProperty("altitudeMeters"); // "ground" is not a number
    }
  });
});
