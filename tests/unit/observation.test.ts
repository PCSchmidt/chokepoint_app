/**
 * Deterministic domain tests (CHOKEPOINT-PLAN.md §12.1, Phase 1 subset):
 * normalization, invalid coordinate rejection, timestamp ordering, duplicate
 * handling, and entity identity stability. All inputs are SIMULATED fixtures.
 */

import { describe, expect, it } from "vitest";
import {
  compareByTime,
  dedupeObservations,
  entityKey,
  isValidLatitude,
  isValidLongitude,
  normalizeObservation,
  sortObservations,
} from "../../src/data/observation";

const baseRecord = {
  observationId: "sim-test-001",
  entityId: "simulated-fixture:mmsi-567000001",
  mode: "sea",
  entityType: "cargo_vessel",
  position: { latitude: 33.6, longitude: -118.2 },
  kinematics: { speedKnots: 12.5, headingDegrees: 40 },
  observedAt: "2026-09-09T12:00:00Z",
  receivedAt: "2026-09-09T12:01:00Z",
  source: {
    providerId: "simulated-fixture",
    endpointId: "fixture://test",
    recordRef: "test-rec-1",
    licenseId: "CC0-1.0-synthetic",
  },
  quality: { sourceState: "fresh", positionAccuracy: "exact", classification: "confirmed" },
};

describe("normalization", () => {
  it("accepts a fully valid record and preserves all fields", () => {
    const result = normalizeObservation(baseRecord);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const o = result.observation;
    expect(o.observationId).toBe("sim-test-001");
    expect(o.entityId).toBe("simulated-fixture:mmsi-567000001");
    expect(o.position).toEqual({ latitude: 33.6, longitude: -118.2 });
    expect(o.kinematics).toEqual({ speedKnots: 12.5, headingDegrees: 40 });
    // Provider timestamps are preserved, never replaced with receipt time.
    expect(o.observedAt).toBe("2026-09-09T12:00:00Z");
    expect(o.receivedAt).toBe("2026-09-09T12:01:00Z");
    expect(o.source.recordRef).toBe("test-rec-1");
    expect(o.quality.sourceState).toBe("fresh");
  });

  it("rejects records with missing required fields", () => {
    for (const key of ["observationId", "entityId", "mode", "entityType", "observedAt", "receivedAt"]) {
      const broken: Record<string, unknown> = structuredClone(baseRecord);
      delete broken[key];
      const result = normalizeObservation(broken);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(key);
    }
  });

  it("rejects unknown enum values for mode, entityType, and quality states", () => {
    expect(normalizeObservation({ ...baseRecord, mode: "hyperloop" }).ok).toBe(false);
    expect(normalizeObservation({ ...baseRecord, entityType: "ufo" }).ok).toBe(false);
    const badQuality = structuredClone(baseRecord) as Record<string, unknown>;
    (badQuality["quality"] as Record<string, unknown>)["sourceState"] = "totally-fine";
    expect(normalizeObservation(badQuality).ok).toBe(false);
    (badQuality["quality"] as Record<string, unknown>)["classification"] = "vibes";
    expect(normalizeObservation(badQuality).ok).toBe(false);
  });

  it("rejects non-numeric or NaN kinematics", () => {
    const bad = structuredClone(baseRecord) as Record<string, unknown>;
    (bad["kinematics"] as Record<string, unknown>)["speedKnots"] = "fast";
    expect(normalizeObservation(bad).ok).toBe(false);
    (bad["kinematics"] as Record<string, unknown>)["speedKnots"] = Number.NaN;
    expect(normalizeObservation(bad).ok).toBe(false);
  });

  it("rejects headings outside [0, 360)", () => {
    const bad = structuredClone(baseRecord) as Record<string, unknown>;
    (bad["kinematics"] as Record<string, unknown>)["headingDegrees"] = 361;
    expect(normalizeObservation(bad).ok).toBe(false);
    (bad["kinematics"] as Record<string, unknown>)["headingDegrees"] = -1;
    expect(normalizeObservation(bad).ok).toBe(false);
  });

  it("rejects malformed timestamps", () => {
    expect(normalizeObservation({ ...baseRecord, observedAt: "yesterday" }).ok).toBe(false);
    expect(normalizeObservation({ ...baseRecord, receivedAt: 12345 }).ok).toBe(false);
  });
});

describe("invalid coordinate rejection", () => {
  it("rejects latitude beyond +/-90 (never clamped)", () => {
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90.1)).toBe(false);
    expect(isValidLatitude(-90.1)).toBe(false);
    expect(normalizeObservation({ ...baseRecord, position: { latitude: 91, longitude: 0 } }).ok).toBe(false);
  });

  it("rejects longitude beyond +/-180 (never clamped)", () => {
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180.5)).toBe(false);
    expect(normalizeObservation({ ...baseRecord, position: { latitude: 0, longitude: -181 } }).ok).toBe(false);
  });

  it("rejects NaN and non-numeric coordinates", () => {
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLatitude(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidLongitude(Number.NaN)).toBe(false);
    const bad = structuredClone(baseRecord) as Record<string, unknown>;
    (bad["position"] as Record<string, unknown>)["latitude"] = "33.6";
    expect(normalizeObservation(bad).ok).toBe(false);
  });
});

describe("timestamp ordering", () => {
  const o = (id: string, entityId: string, observedAt: string) =>
    normalizeObservation({ ...baseRecord, observationId: id, entityId, observedAt });

  it("sorts out-of-order records chronologically", () => {
    const a = o("a", "entity-x", "2026-09-09T12:10:00Z");
    const b = o("b", "entity-x", "2026-09-09T12:02:00Z");
    const c = o("c", "entity-x", "2026-09-09T12:06:00Z");
    if (!a.ok || !b.ok || !c.ok) throw new Error("test records must normalize");
    const sorted = sortObservations([a.observation, b.observation, c.observation]);
    expect(sorted.map((x) => x.observationId)).toEqual(["b", "c", "a"]);
  });

  it("is a total order with deterministic tie-breaking", () => {
    const a = o("t1", "entity-y", "2026-09-09T12:00:00Z");
    const b = o("t2", "entity-y", "2026-09-09T12:00:00Z");
    if (!a.ok || !b.ok) throw new Error("test records must normalize");
    const forward = sortObservations([b.observation, a.observation]);
    const backward = sortObservations([a.observation, b.observation]);
    expect(forward).toEqual(backward);
    expect(compareByTime(a.observation, a.observation)).toBe(0);
  });

  it("sorting is idempotent", () => {
    const list = [o("p1", "e", "2026-09-09T12:05:00Z"), o("p2", "e", "2026-09-09T12:01:00Z")];
    if (!list[0]!.ok || !list[1]!.ok) throw new Error("test records must normalize");
    const once = sortObservations([list[1]!.observation, list[0]!.observation]);
    const twice = sortObservations(once);
    expect(twice).toEqual(once);
  });
});

describe("duplicate handling", () => {
  it("deduplicates identical recordRefs deterministically regardless of input order", () => {
    const rec = (id: string, ref: string) =>
      normalizeObservation({ ...baseRecord, observationId: id, source: { ...baseRecord.source, recordRef: ref } });
    const a = rec("d1", "ref-A");
    const b = rec("d2", "ref-A");
    if (!a.ok || !b.ok) throw new Error("test records must normalize");

    const forward = dedupeObservations([a.observation, b.observation]);
    const backward = dedupeObservations([b.observation, a.observation]);
    expect(forward.unique).toHaveLength(1);
    expect(backward.unique).toHaveLength(1);
    expect(forward.unique).toEqual(backward.unique);
    expect(forward.duplicatesRemoved).toBe(1);
  });

  it("falls back to entity+time+position when recordRef is absent", () => {
    const rec = (id: string, lon: number) => {
      const { recordRef: _omit, ...source } = baseRecord.source;
      return normalizeObservation({ ...baseRecord, observationId: id, source, position: { latitude: 33.6, longitude: lon } });
    };
    const a = rec("n1", -118.2);
    const b = rec("n2", -118.2);
    const c = rec("n3", -118.1);
    if (!a.ok || !b.ok || !c.ok) throw new Error("test records must normalize");
    const { unique, duplicatesRemoved } = dedupeObservations([a.observation, b.observation, c.observation]);
    expect(unique).toHaveLength(2);
    expect(duplicatesRemoved).toBe(1);
  });

  it("does not merge distinct recordRefs from the same provider", () => {
    const rec = (ref: string) =>
      normalizeObservation({ ...baseRecord, source: { ...baseRecord.source, recordRef: ref } });
    const a = rec("ref-1");
    const b = rec("ref-2");
    if (!a.ok || !b.ok) throw new Error("test records must normalize");
    const { unique } = dedupeObservations([a.observation, b.observation]);
    expect(unique).toHaveLength(2);
  });
});

describe("entity identity stability", () => {
  it("returns an identical key for the same provider reference", () => {
    const k1 = entityKey("simulated-fixture", "mmsi-567000009");
    const k2 = entityKey("simulated-fixture", "mmsi-567000009");
    expect(k1).toBe(k2);
    expect(k1).toBe("simulated-fixture:mmsi-567000009");
  });

  it("is robust to formatting differences (case, whitespace)", () => {
    expect(entityKey("Simulated-Fixture", "  MMSI-567000009 ")).toBe(entityKey("simulated-fixture", "mmsi-567000009"));
  });

  it("keeps distinct entities and providers separate", () => {
    expect(entityKey("simulated-fixture", "mmsi-1")).not.toBe(entityKey("simulated-fixture", "mmsi-2"));
    expect(entityKey("provider-a", "mmsi-1")).not.toBe(entityKey("provider-b", "mmsi-1"));
  });

  it("rejects empty identity components", () => {
    expect(() => entityKey("provider", "   ")).toThrow();
    expect(() => entityKey("", "mmsi-1")).toThrow();
  });
});
