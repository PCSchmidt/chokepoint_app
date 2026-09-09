/**
 * Geofence registry (CHOKEPOINT-PLAN.md §5.4, §3.3; ADR-0007).
 *
 * A reviewed geofence is a versioned record with the full §5.4 metadata set:
 * stable id, human-readable purpose, geometry version, coordinate reference
 * assumptions, inclusion rules, effective date, review owner, and
 * source/rationale. Membership computation REFUSES any geofence that is not
 * `reviewed` — placeholder or candidate geometry can never silently feed
 * metrics (ADR-0007).
 *
 * Point-in-polygon uses even-odd ray casting in lat/lon space (WGS84). This is
 * deliberately coarse: at chokepoint scales (kilometers) the lat/lon planar
 * approximation is accurate to well under a meter of relevance and keeps the
 * implementation deterministic and testable. Geodesic edge exactness is NOT a
 * goal for a demo geofence (see ADR-0007: "not official boundaries").
 */

import type { Geofence } from "../config/chokepoints";

/** An ordered ring of [lat, lon] pairs, WGS84 (EPSG:4326). */
export type PolygonRing = ReadonlyArray<readonly [number, number]>;

/** The full §5.4 reviewed-geofence record. */
export interface ReviewedGeofence {
  id: string;
  /** Human-readable purpose (§5.4), e.g. "waiting-cohort", "approach-flow". */
  purpose: string;
  geometryVersion: string;
  geometryStatus: "reviewed";
  reviewOwner: string;
  coordinateReference: "EPSG:4326";
  effectiveDate: string;
  /** Inclusion/exclusion rules in plain language (§5.4). */
  inclusionRule: string;
  /** Source citation and rationale (§5.4). */
  sourceRationale: string;
  polygon: PolygonRing;
}

/** Re-export the config-side guard type for membership call sites. */
export type { Geofence };

export interface MembershipResult {
  inside: boolean;
  /** The geofence that was evaluated. */
  geofenceId: string;
  geometryVersion: string;
}

/**
 * Validate a ring before it can ever be registered: at least 4 vertices
 * (a triangle plus closing vertex or a valid open ring), finite coordinates,
 * latitude within [-90, 90], longitude within [-180, 180]. Coordinates are
 * rejected, never clamped (§3.3).
 */
export function validatePolygonRing(ring: PolygonRing): void {
  if (ring.length < 4) {
    throw new Error("polygon ring must have at least 4 vertices");
  }
  for (const [lat, lon] of ring) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new Error(`invalid latitude in polygon ring: ${String(lat)}`);
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error(`invalid longitude in polygon ring: ${String(lon)}`);
    }
  }
}

/** Full §5.4 record validation before registration. */
export function validateReviewedGeofence(fence: ReviewedGeofence): void {
  if (fence.geometryStatus !== "reviewed") {
    throw new Error(`geofence "${fence.id}" is not reviewed; membership is blocked (ADR-0007)`);
  }
  if (!fence.reviewOwner || fence.reviewOwner.trim().length === 0) {
    throw new Error(`geofence "${fence.id}" requires a named review owner (§5.4)`);
  }
  if (Number.isNaN(Date.parse(fence.effectiveDate))) {
    throw new Error(`geofence "${fence.id}" requires a valid effectiveDate`);
  }
  if (!fence.inclusionRule || !fence.sourceRationale) {
    throw new Error(`geofence "${fence.id}" requires inclusionRule and sourceRationale (§5.4)`);
  }
  validatePolygonRing(fence.polygon);
}

/**
 * Even-odd ray casting. A point exactly on an edge is an implementation
 * boundary condition; this implementation treats it as OUTSIDE by construction
 * of the half-open edge test. Callers needing edge semantics must document the
 * inclusion rule (§5.4) — coarse demo fences should use a margin instead.
 */
export function pointInPolygon(lat: number, lon: number, ring: PolygonRing): boolean {
  validatePolygonRing(ring);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const latI = ring[i]![0];
    const lonI = ring[i]![1];
    const latJ = ring[j]![0];
    const lonJ = ring[j]![1];
    const intersects =
      lonI > lon !== lonJ > lon &&
      lat < ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Membership against a REVIEWED geofence. Throws for placeholder/candidate
 * geometry — the ADR-0007 guard, enforced here at the point of use.
 */
export function geofenceMembership(
  fence: Geofence | ReviewedGeofence,
  lat: number,
  lon: number,
): MembershipResult {
  if (fence.geometryStatus !== "reviewed") {
    throw new Error(
      `geofence "${fence.id}" has ${fence.geometryStatus} geometry; membership computation is blocked ` +
        "until a reviewer commits reviewed geometry (ADR-0007, plan §5.4)"
    );
  }
  const reviewed = fence as ReviewedGeofence;
  validatePolygonRing(reviewed.polygon);
  return {
    inside: pointInPolygon(lat, lon, reviewed.polygon),
    geofenceId: reviewed.id,
    geometryVersion: reviewed.geometryVersion,
  };
}

/**
 * Membership predicate in the shape the Phase 2 metrics expect
 * (src/analytics/metrics.ts MembershipPredicate). Throws on non-reviewed fences.
 */
export function membershipPredicate(
  fence: Geofence | ReviewedGeofence,
): (o: import("../data/observation").TransportObservation) => boolean {
  return (o) => geofenceMembership(fence, o.position.latitude, o.position.longitude).inside;
}

/**
 * The geofence registry: reviewed fences currently registered for production
 * use. EMPTY by design until the review owner approves candidate geometry
 * (research/geofence-candidates.md). Phase 2 geofence-bound metrics read this
 * registry, never hardcoded polygons.
 */
export const REVIEWED_GEOFENCE_REGISTRY: readonly ReviewedGeofence[] = [];

export function getReviewedGeofence(id: string): ReviewedGeofence | undefined {
  return REVIEWED_GEOFENCE_REGISTRY.find((f) => f.id === id);
}
