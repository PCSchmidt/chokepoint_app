/**
 * Phase 2 analytics tests (CHOKEPOINT-PLAN.md §12.1, §17 Phase 2 slice):
 * track segmentation, classification rules, moving fraction, dwell estimate.
 * All inputs are SIMULATED fixtures; all results are DERIVED metrics with
 * provenance. Geofence-dependent metrics are intentionally absent.
 */

import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { parseFixture } from "../../src/data/fixtureLoader";
import { buildTracks } from "../../src/analytics/tracks";
import { cohortByClassification, entityClassifications } from "../../src/analytics/observations";
import {
  movingFraction,
  dwellEstimates,
  vesselCount,
  entryExitCounts,
  provenanceForMetricInputs,
  MOVING_FRACTION_FORMULA_VERSION,
  DWELL_FORMULA_VERSION,
} from "../../src/analytics/metrics";
import { normalizeObservation, type TransportObservation } from "../../src/data/observation";

const fixturesDir = path.resolve("tests/fixtures");

async function loadFixture(name: string) {
  const raw = JSON.parse(await readFile(path.join(fixturesDir, name), "utf-8"));
  return parseFixture(raw);
}

const BASE = {
  computedAt: "2026-09-09T14:00:00Z",
  truthState: "SIMULATED" as const,
  observationWindow: { startAt: "2026-09-09T10:00:00Z", endAt: "2026-09-09T14:00:00Z" },
};

describe("track segmentation (§5.3)", () => {
  it("normal-transit: one segment, five observed points, expected gaps, no interpolation", async () => {
    const fx = await loadFixture("normal-transit.json");
    const tracks = buildTracks(fx.observations, { maxGapSeconds: 3600 });
    expect(tracks).toHaveLength(1);
    const t = tracks[0]!;
    expect(t.entityId).toBe("simulated-fixture:mmsi-567001001");
    expect(t.quality.observedPointCount).toBe(5);
    expect(t.quality.interpolatedPointCount).toBe(0);
    expect(t.interpolation.method).toBe("none");
    expect(t.quality.largestGapSeconds).toBe(300);
    expect(t.startAt).toBe("2026-09-09T12:00:00Z");
    expect(t.endAt).toBe("2026-09-09T12:20:00Z");
    expect(t.observations).toHaveLength(5);
  });

  it("missing-intervals: a 3h gap splits tracks when maxGapSeconds is 1800", async () => {
    const fx = await loadFixture("missing-intervals.json");
    const split = buildTracks(fx.observations, { maxGapSeconds: 1800 });
    expect(split).toHaveLength(2);
    expect(split[0]!.quality.observedPointCount).toBe(2);
    expect(split[1]!.quality.observedPointCount).toBe(2);
    // Same entity, both segments carry it.
    expect(split.every((t) => t.entityId === "simulated-fixture:mmsi-567001004")).toBe(true);
  });

  it("missing-intervals: with a permissive maxGap the gap stays inside one segment", async () => {
    const fx = await loadFixture("missing-intervals.json");
    const tracks = buildTracks(fx.observations, { maxGapSeconds: 4 * 3600 });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.quality.largestGapSeconds).toBe(10800);
  });

  it("deterministic: same observations produce identical tracks in identical order", async () => {
    const fx = await loadFixture("normal-transit.json");
    const a = buildTracks(fx.observations, { maxGapSeconds: 3600 });
    const b = buildTracks([...fx.observations].reverse(), { maxGapSeconds: 3600 });
    expect(a).toEqual(b);
  });

  it("mixed source states aggregate to the WORST state (degraded stays degraded)", async () => {
    const fx = await loadFixture("normal-transit.json");
    const degraded: TransportObservation = {
      ...fx.observations[0]!,
      observationId: "synthetic-degraded-1",
      quality: { ...fx.observations[0]!.quality, sourceState: "degraded" },
    };
    const tracks = buildTracks([...fx.observations, degraded], { maxGapSeconds: 3600 });
    // The degraded record joins the same entity timeline (same entityId).
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.quality.sourceState).toBe("degraded");
  });
});

describe("classification rules (§3.3)", () => {
  it("classification-change: most recent accepted observation wins", async () => {
    const fx = await loadFixture("classification-change.json");
    const classifications = entityClassifications(fx.observations);
    const c = classifications.get("simulated-fixture:mmsi-567001007")!;
    expect(c.entityType).toBe("unknown"); // last record: entityType unknown, classification unknown
    expect(c.reliable).toBe(false);
    expect(c.decidedBy).toBe("classification-change-004");
    expect(c.classificationChanges).toBe(2); // cargo->tanker->unknown
  });

  it("unreliable classification excludes the entity from freight totals, counted as UNCLASSIFIED", async () => {
    const fx = await loadFixture("classification-change.json");
    const cohort = cohortByClassification(fx.observations);
    expect(cohort.freight).toEqual([]);
    expect(cohort.unclassified).toEqual(["simulated-fixture:mmsi-567001007"]);
    expect(cohort.other).toEqual([]);
  });

  it("confirmed tanker counts as freight; confirmed cargo counts as freight", async () => {
    const anchorage = await loadFixture("stationary-anchorage.json");
    const cohortAnchorage = cohortByClassification(anchorage.observations);
    expect(cohortAnchorage.freight).toEqual(["simulated-fixture:mmsi-567001002"]); // tanker, confirmed

    const transit = await loadFixture("normal-transit.json");
    const cohortTransit = cohortByClassification(transit.observations);
    expect(cohortTransit.freight).toEqual(["simulated-fixture:mmsi-567001001"]); // cargo, confirmed
    expect(cohortTransit.unclassified).toEqual([]);
  });
});

describe("moving fraction (§7.2)", () => {
  it("all-moving cohort: 1.0", async () => {
    const fx = await loadFixture("normal-transit.json");
    const m = movingFraction(fx.observations, { ...BASE, speedKnotsThreshold: 0.5 });
    expect(m.value).toBe(1);
    expect(m.quality.sampleCount).toBe(1);
    expect(m.formulaVersion).toBe(MOVING_FRACTION_FORMULA_VERSION);
    expect(m.quality.state).toBe("fresh");
  });

  it("stationary cohort: 0.0, still a valid metric", async () => {
    const fx = await loadFixture("stationary-anchorage.json");
    const m = movingFraction(fx.observations, { ...BASE, speedKnotsThreshold: 0.5 });
    expect(m.value).toBe(0);
  });

  it("missing speed is not counted as stopped: excluded from denominator and noted", async () => {
    const transit = await loadFixture("normal-transit.json");
    const noSpeed: TransportObservation = {
      ...transit.observations[0]!,
      observationId: "synthetic-nospeed-1",
      entityId: "simulated-fixture:mmsi-567009999",
      kinematics: {}, // no speed observation at all
    };
    const m = movingFraction([...transit.observations, noSpeed], { ...BASE, speedKnotsThreshold: 0.5 });
    expect(m.value).toBe(1); // denominator is still 1 entity (the one with speed)
    expect(m.quality.sampleCount).toBe(1);
    expect(m.quality.coverageNote).toMatch(/1 entity\(ies\) excluded: no speed observation/);
  });

  it("empty eligibility returns null with UNKNOWN quality, not a fake estimate (§3.3)", async () => {
    const fx = await loadFixture("normal-transit.json");
    const m = movingFraction(fx.observations, {
      ...BASE,
      speedKnotsThreshold: 0.5,
      observationWindow: { startAt: "2020-01-01T00:00:00Z", endAt: "2020-01-02T00:00:00Z" },
    });
    expect(m.value).toBeNull();
    expect(m.quality.state).toBe("unknown");
  });

  it("restricted to the freight cohort via entityIds", async () => {
    const a = await loadFixture("normal-transit.json");
    const b = await loadFixture("stationary-anchorage.json");
    const cohort = cohortByClassification([...a.observations, ...b.observations]);
    const m = movingFraction([...a.observations, ...b.observations], {
      ...BASE,
      speedKnotsThreshold: 0.5,
      entityIds: cohort.freight,
    });
    expect(m.quality.sampleCount).toBe(2);
    expect(m.value).toBeCloseTo(0.5, 10);
    expect(m.quality.coverageNote).toMatch(/allowlist/);
  });
});

describe("dwell estimate (§7.4)", () => {
  // Membership predicate built from the fixture's own declared scenario bbox —
  // NOT a geofence. The geofence registry plugs a versioned predicate later.
  const bboxMembership = (box: { minLat: number; minLon: number; maxLat: number; maxLon: number }) =>
    (o: TransportObservation) =>
      o.position.latitude >= box.minLat && o.position.latitude <= box.maxLat &&
      o.position.longitude >= box.minLon && o.position.longitude <= box.maxLon;

  it("port-entry-exit: entity dwell covers only the in-scope interval", async () => {
    const raw = JSON.parse(await readFile(path.join(fixturesDir, "port-entry-exit.json"), "utf-8"));
    const fx = parseFixture(raw);
    const result = dwellEstimates(fx.observations, {
      ...BASE,
      membership: bboxMembership(raw.scenario.regionBbox),
      minObservations: 2,
      maxGapSeconds: 3600,
    });
    expect(result.perEntity).toHaveLength(1);
    const d = result.perEntity[0]!;
    expect(d.entityId).toBe("simulated-fixture:mmsi-567001003");
    expect(d.observationCount).toBe(3); // 12:12, 12:24, 12:36 are inside the bbox
    expect(d.firstInsideAt).toBe("2026-09-09T12:12:00Z");
    expect(d.lastInsideAt).toBe("2026-09-09T12:36:00Z");
    expect(d.dwellSeconds).toBe(1440);
    expect(result.cohortSize.value).toBe(1);
    expect(result.medianDwellSeconds.value).toBe(1440);
    expect(result.cohortSize.formulaVersion).toBe(DWELL_FORMULA_VERSION);
  });

  it("a too-long in-scope gap splits visits; the longest visit is kept conservatively", async () => {
    const fx = await loadFixture("missing-intervals.json");
    // All four points are "inside" by this always-true predicate; the 3h gap
    // exceeds maxGapSeconds=1800, so two visits of 2 points each exist.
    const result = dwellEstimates(fx.observations, {
      ...BASE,
      membership: () => true,
      minObservations: 2,
      maxGapSeconds: 1800,
    });
    expect(result.perEntity).toHaveLength(1);
    expect(result.perEntity[0]!.observationCount).toBe(2); // longest visit, not the merged 4
    expect(result.cohortSize.quality.coverageNote).toMatch(/Not official port dwell time/);
  });

  it("entities below minObservations are excluded entirely", async () => {
    const fx = await loadFixture("missing-intervals.json");
    const result = dwellEstimates(fx.observations, {
      ...BASE,
      membership: () => true,
      minObservations: 10,
      maxGapSeconds: 4 * 3600,
    });
    expect(result.perEntity).toHaveLength(0);
    expect(result.cohortSize.value).toBe(0);
    expect(result.medianDwellSeconds.value).toBeNull();
    expect(result.cohortSize.quality.state).toBe("unknown");
  });
});

describe("provenance propagation (§3.2, §3.3)", () => {
  it("single-provider metric inputs yield one SIMULATED provenance record", async () => {
    const fx = await loadFixture("normal-transit.json");
    const m = movingFraction(fx.observations, { ...BASE, speedKnotsThreshold: 0.5 });
    const records = provenanceForMetricInputs(
      fx.observations.filter((o) => m.inputs.includes(o.observationId)),
      "SIMULATED",
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.truthState).toBe("SIMULATED");
    expect(records[0]!.observationIds).toEqual(m.inputs);
    expect(records[0]!.observationInterval.startAt).toBe("2026-09-09T12:00:00Z");
  });

  it("multi-provider inputs yield one provenance record per provider (conflicts stay visible)", async () => {
    const fx = await loadFixture("conflicting-sources.json");
    const records = provenanceForMetricInputs(fx.observations, "SIMULATED");
    expect(records).toHaveLength(2);
    expect(new Set(records.map((r) => r.providerId))).toEqual(
      new Set(["simulated-fixture", "simulated-fixture-b"])
    );
  });
});

// ---------------------------------------------------------------------------
// Geofence-bound metrics (§7.1, §7.3) — unblocked by geometry v1 (ADR-0011)
// ---------------------------------------------------------------------------

import { CHOKEPOINT_REGISTRY } from "../../src/config/chokepoints";
import { toReviewedGeofence } from "../../src/data/geofences";

function reviewedFence(id: string) {
  const fence = CHOKEPOINT_REGISTRY.flatMap((c) => c.geofences).find((g) => g.id === id);
  if (!fence) throw new Error(`fence ${id} not found`);
  return toReviewedGeofence(fence);
}

const synth = (id: string, lat: number, lon: number, minutes: number, speed = 12, entity = "simulated-fixture:mmsi-990000001") => {
  const observed = new Date(Date.parse("2026-09-09T12:00:00Z") + minutes * 60000)
    .toISOString()
    .replace(".000Z", "Z");
  const received = new Date(Date.parse(observed) + 30000).toISOString().replace(".000Z", "Z");
  const result = normalizeObservation({
    observationId: id,
    entityId: entity,
    mode: "sea",
    entityType: "cargo_vessel",
    position: { latitude: lat, longitude: lon },
    kinematics: { speedKnots: speed },
    observedAt: observed,
    receivedAt: received,
    source: { providerId: "simulated-fixture", endpointId: "fixture://synthetic", recordRef: id, licenseId: "CC0-1.0-synthetic" },
    quality: { sourceState: "fresh", classification: "confirmed" },
  });
  if (!result.ok) throw new Error(`synthetic record ${id} must normalize: ${!result.ok ? result.reason : ""}`);
  return result.observation;
};

describe("vessel count (§7.1, reviewed geometry)", () => {
  const anchorage = reviewedFence("outer-anchorage");

  it("counts unique entities with an accepted observation inside the fence", () => {
    // Both positions inside the LB outer-anchorage ring (lat 33.638-33.718, lon -118.24..-118.10).
    const observations = [
      synth("vc-1", 33.68, -118.17, 0),
      synth("vc-2", 33.69, -118.16, 10),
      synth("vc-3", 33.70, -118.15, 20, 12, "simulated-fixture:mmsi-990000002"), // second entity
    ];
    const m = vesselCount(observations, {
      ...BASE,
      fences: [anchorage],
    });
    expect(m.value).toBe(2);
    expect(m.metricType).toBe("vessel_count");
    expect(m.scope).toContain("outer-anchorage");
    expect(m.scope).toContain("2026-09-09-v1");
    expect(m.quality.coverageNote).toContain("observed vessels in the defined geofence");
  });

  it("excludes vessels outside the fence entirely", () => {
    const observations = [
      synth("vc-4", 33.68, -118.17, 0),   // inside
      synth("vc-5", 33.30, -118.10, 10),  // far south, outside
    ];
    const m = vesselCount(observations, { ...BASE, fences: [anchorage] });
    expect(m.value).toBe(1);
  });

  it("unclassified entities are excluded from the count and reported (§3.3)", () => {
    const unknownVessel = synth("vc-6", 33.68, -118.17, 0, 12, "simulated-fixture:mmsi-990000003");
    const unclassified: TransportObservation = {
      ...unknownVessel,
      quality: { ...unknownVessel.quality, classification: "unknown" },
    };
    const m = vesselCount([unclassified], { ...BASE, fences: [anchorage] });
    expect(m.value).toBe(0);
    expect(m.quality.coverageNote).toMatch(/1 unclassified entity\(ies\) excluded/);
  });

  it("empty in-fence population returns UNKNOWN, not zero-confidence counts", () => {
    const m = vesselCount([synth("vc-7", 33.30, -118.10, 0)], { ...BASE, fences: [anchorage] });
    expect(m.value).toBe(0);
    expect(m.quality.state).toBe("unknown");
  });

  it("works against the other regional fences too (registry-driven, not hardcoded)", () => {
    const suez = reviewedFence("gulf-of-suez-approach");
    // Inside the Gulf of Suez envelope (lat ~29.6-29.93, lon ~32.4-32.6).
    const m = vesselCount([synth("vc-8", 29.75, 32.50, 0)], { ...BASE, fences: [suez] });
    expect(m.value).toBe(1);
  });
});

describe("entry/exit counts (§7.3, reviewed geometry)", () => {
  const anchorage = reviewedFence("outer-anchorage");

  it("detects one inbound and one outbound crossing for a transit path", () => {
    // Path: south (outside) -> inside -> inside -> north (outside).
    const observations = [
      synth("ee-1", 33.55, -118.17, 0),  // outside (south)
      synth("ee-2", 33.68, -118.17, 10), // inside (entry)
      synth("ee-3", 33.70, -118.17, 20), // inside
      synth("ee-4", 33.80, -118.17, 30), // outside (north, exit)
    ];
    const result = entryExitCounts(observations, { ...BASE, fence: anchorage, maxGapSeconds: 3600 });
    expect(result.entries.value).toBe(1);
    expect(result.exits.value).toBe(1);
    expect(result.uncertainCrossings).toBe(0);
    expect(result.entries.formulaVersion).toBe("entry-exit-v1");
  });

  it("staying inside produces no crossings", () => {
    const observations = [
      synth("ee-5", 33.68, -118.17, 0),
      synth("ee-6", 33.69, -118.16, 10),
      synth("ee-7", 33.70, -118.15, 20),
    ];
    const result = entryExitCounts(observations, { ...BASE, fence: anchorage, maxGapSeconds: 3600 });
    expect(result.entries.value).toBe(0);
    expect(result.exits.value).toBe(0);
  });

  it("excessive gaps mark crossings uncertain and EXCLUDE them from counts (§7.3)", () => {
    const observations = [
      synth("ee-8", 33.55, -118.17, 0),                 // outside
      synth("ee-9", 33.68, -118.17, 90),                // inside, but 90 min gap > 3600s? no, 5400s > 3600s
    ];
    const result = entryExitCounts(observations, { ...BASE, fence: anchorage, maxGapSeconds: 3600 });
    expect(result.uncertainCrossings).toBe(1);
    expect(result.entries.value).toBe(0);
    expect(result.entries.quality.coverageNote).toMatch(/1 uncertain crossing\(s\) excluded/);
  });

  it("multiple entities are counted independently (unique crossings)", () => {
    const observations = [
      synth("ee-a", 33.68, -118.17, 0, 12, "simulated-fixture:mmsi-990000010"),
      synth("ee-b", 33.55, -118.17, 10, 12, "simulated-fixture:mmsi-990000010"), // exit
      synth("ee-c", 33.68, -118.17, 20, 12, "simulated-fixture:mmsi-990000011"), // entry (starts inside -> no entry event)
    ];
    const result = entryExitCounts(observations, { ...BASE, fence: anchorage, maxGapSeconds: 3600 });
    expect(result.exits.value).toBe(1);
    expect(result.entries.value).toBe(0);
  });

  it("works against the port-said fence (registry-driven)", () => {
    const portSaid = reviewedFence("port-said-approach");
    const observations = [
      synth("ee-d", 31.20, 32.35, 0),   // south of the fence, outside
      synth("ee-e", 31.42, 32.35, 10),  // inside
    ];
    const result = entryExitCounts(observations, { ...BASE, fence: portSaid, maxGapSeconds: 3600 });
    expect(result.entries.value).toBe(1);
  });
});
