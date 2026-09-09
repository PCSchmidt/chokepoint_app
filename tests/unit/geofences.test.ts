/**
 * Geofence registry tests (§5.4, §12.1, ADR-0007): placeholder/candidate
 * geometry is blocked from membership; reviewed geometry computes deterministic
 * point-in-polygon membership. The only reviewed polygon in tests is a
 * synthetic test fixture — real candidate polygons stay unapproved in
 * research/geofence-candidates.md until the review owner commits them.
 */

import { describe, expect, it } from "vitest";
import {
  geofenceMembership,
  membershipPredicate,
  pointInPolygon,
  REVIEWED_GEOFENCE_REGISTRY,
  validatePolygonRing,
  validateReviewedGeofence,
  type ReviewedGeofence,
} from "../../src/data/geofences";
import { CHOKEPOINT_REGISTRY } from "../../src/config/chokepoints";
import { normalizeObservation } from "../../src/data/observation";

// SYNTHETIC TEST-REVIEWED polygon (a simple square off the California coast,
// clearly not a real chokepoint boundary — used only to test the machinery).
const TEST_FENCE: ReviewedGeofence = {
  id: "test-square",
  purpose: "approach-flow",
  geometryVersion: "test-1",
  geometryStatus: "reviewed",
  reviewOwner: "test-suite",
  coordinateReference: "EPSG:4326",
  effectiveDate: "2026-09-09",
  inclusionRule: "point-in-polygon, even-odd ray casting, no margin",
  sourceRationale: "Synthetic test polygon; machinery test only, not real geometry.",
  polygon: [
    [33.0, -119.0],
    [33.0, -118.0],
    [34.0, -118.0],
    [34.0, -119.0],
  ],
};

describe("ADR-0007 guard", () => {
  it("production fences are reviewed v1 and membership works", () => {
    for (const c of CHOKEPOINT_REGISTRY) {
      for (const g of c.geofences) {
        expect(g.geometryStatus).toBe("reviewed");
        const ring = g.geometry.kind === "polygon" ? g.geometry.ring : undefined;
        if (!ring) throw new Error("reviewed fences must be polygons");
        const centroidLat = ring.reduce((s: number, v: readonly [number, number]) => s + v[0], 0) / ring.length;
        const centroidLon = ring.reduce((s: number, v: readonly [number, number]) => s + v[1], 0) / ring.length;
        const result = geofenceMembership(g, centroidLat, centroidLon);
        expect(result.inside).toBe(true);
        expect(result.geometryVersion).toBe(g.geometryVersion);
      }
    }
  });

  it("still blocks placeholder geometry at the point of use", () => {
    const placeholder = { ...CHOKEPOINT_REGISTRY[0]!.geofences[0]!, geometryStatus: "placeholder" as const };
    expect(() => geofenceMembership(placeholder, 33.6, -118.2)).toThrow(/blocked/);
  });

  it("the registry contains exactly the six reviewed v1 fences", () => {
    expect(REVIEWED_GEOFENCE_REGISTRY.map((f) => f.id).sort()).toEqual(
      [
        "outer-anchorage",
        "approach-corridor",
        "strait-traffic-corridor",
        "singapore-roadstead",
        "gulf-of-suez-approach",
        "port-said-approach",
      ].sort()
    );
    for (const f of REVIEWED_GEOFENCE_REGISTRY) {
      expect(f.reviewOwner).toBe("ChrisSchmidt (GitHub: PCSchmidt)");
      expect(f.geometryVersion).toBe("2026-09-09-v1");
    }
  });

  it("membership is verifiably spatial: points far away are outside every fence", () => {
    for (const f of REVIEWED_GEOFENCE_REGISTRY) {
      // Mid-Atlantic point is outside all three regions.
      expect(geofenceMembership(f, 40.0, -40.0).inside).toBe(false);
    }
  });
});

describe("point-in-polygon (even-odd ray casting)", () => {
  it("classifies interior, exterior, and far-outside points", () => {
    expect(pointInPolygon(33.5, -118.5, TEST_FENCE.polygon)).toBe(true);
    expect(pointInPolygon(34.5, -118.5, TEST_FENCE.polygon)).toBe(false);
    expect(pointInPolygon(33.5, -117.5, TEST_FENCE.polygon)).toBe(false);
    expect(pointInPolygon(0.0, 0.0, TEST_FENCE.polygon)).toBe(false);
  });

  it("is deterministic and symmetric under repeated evaluation", () => {
    const a = pointInPolygon(33.7, -118.3, TEST_FENCE.polygon);
    const b = pointInPolygon(33.7, -118.3, TEST_FENCE.polygon);
    expect(a).toBe(b);
    expect(a).toBe(true);
  });

  it("handles concave rings correctly", () => {
    // L-shaped concave polygon: point in the notch must be OUTSIDE.
    const lShape = [
      [0.0, 0.0],
      [0.0, 10.0],
      [5.0, 10.0],
      [5.0, 5.0],
      [10.0, 5.0],
      [10.0, 0.0],
    ] as const;
    expect(pointInPolygon(2.5, 2.5, lShape)).toBe(true); // in the L body
    expect(pointInPolygon(7.5, 7.5, lShape)).toBe(false); // in the notch
    expect(pointInPolygon(7.5, 2.5, lShape)).toBe(true); // in the L foot
  });

  it("rejects invalid rings instead of clamping or guessing (§3.3)", () => {
    expect(() => validatePolygonRing([])).toThrow();
    expect(() => validatePolygonRing([[0, 0], [1, 1], [2, 2]])).toThrow(/at least 4/);
    expect(() => validatePolygonRing([[95, 0], [0, 0], [0, 1], [1, 1]] as const)).toThrow(/latitude/);
    expect(() => validatePolygonRing([[0, 200], [0, 0], [0, 1], [1, 1]] as const)).toThrow(/longitude/);
    expect(() => pointInPolygon(Number.NaN, 0, TEST_FENCE.polygon)).not.toThrow(); // NaN point is just outside
  });
});

describe("reviewed geofence validation (§5.4 metadata)", () => {
  it("accepts a complete record", () => {
    expect(() => validateReviewedGeofence(TEST_FENCE)).not.toThrow();
  });

  it("requires a named review owner, effective date, rules, and rationale", () => {
    const missingOwner = { ...TEST_FENCE, reviewOwner: "  " };
    expect(() => validateReviewedGeofence(missingOwner)).toThrow(/review owner/);
    const badDate = { ...TEST_FENCE, effectiveDate: "not-a-date" };
    expect(() => validateReviewedGeofence(badDate)).toThrow(/effectiveDate/);
    const noRule = { ...TEST_FENCE, inclusionRule: "" };
    expect(() => validateReviewedGeofence(noRule)).toThrow(/inclusionRule/);
  });

  it("refuses non-reviewed status outright", () => {
    const candidate = { ...TEST_FENCE, geometryStatus: "candidate" } as unknown as ReviewedGeofence;
    expect(() => geofenceMembership(candidate, 33.5, -118.5)).toThrow(/blocked/);
  });
});

describe("membership predicate for Phase 2 metrics", () => {
  const observation = normalizeObservation({
    observationId: "g-1",
    entityId: "simulated-fixture:mmsi-1",
    mode: "sea",
    entityType: "cargo_vessel",
    position: { latitude: 33.5, longitude: -118.5 },
    kinematics: { speedKnots: 10 },
    observedAt: "2026-09-09T12:00:00Z",
    receivedAt: "2026-09-09T12:01:00Z",
    source: { providerId: "simulated-fixture", endpointId: "fixture://t", licenseId: "CC0-1.0-synthetic" },
    quality: { sourceState: "fresh", classification: "confirmed" },
  });
  if (!observation.ok) throw new Error("test record must normalize");

  it("feeds the metric engine once the fence is reviewed", () => {
    const predicate = membershipPredicate(TEST_FENCE);
    expect(predicate(observation.observation)).toBe(true);
  });

  it("still throws for placeholder fences (metrics cannot silently use them)", () => {
    const reviewed = CHOKEPOINT_REGISTRY[0]!.geofences[0]!;
    const placeholder = {
      ...reviewed,
      geometryStatus: "placeholder" as const,
      reviewOwner: null,
      effectiveDate: null,
      inclusionRule: null,
      geometry: { kind: "placeholder-bbox" as const, minLat: 33, minLon: -119, maxLat: 34, maxLon: -118 },
    };
    expect(() => membershipPredicate(placeholder)(observation.observation)).toThrow(/blocked/);
  });

  it("reports the geometry version that decided membership", () => {
    const result = geofenceMembership(TEST_FENCE, 33.5, -118.5);
    expect(result.geometryVersion).toBe("test-1");
    expect(result.geofenceId).toBe("test-square");
  });
});
