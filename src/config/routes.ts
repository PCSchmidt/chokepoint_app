/**
 * Illustrative corridor routes (NETWORK-VIEW-PLAN.md Phase 1 step 1).
 *
 * Route arcs are DERIVED VISUAL AFFORDANCES, not new geometric claims: each
 * arc's endpoints are the vertex-mean centroid of a profile's ALREADY-REVIEWED
 * primary fence — no new geometry, no new provenance burden. Arcs render as
 * dashed geodesic polylines labeled "illustrative corridor" in the scene; they
 * are a UI affordance (§3.1 truth-state vocabulary), never badged as a DERIVED
 * metric and never presented as a tracked vessel path.
 *
 * The leg list is data-declared and intentionally incomplete: only legs that
 * make narrative sense are declared, and profiles with no meaningful corridor
 * (air, land) are nodes with zero legs. An empty leg list is valid.
 */

import { CHOKEPOINT_REGISTRY, type ChokepointProfile, type PolygonRing } from "./chokepoints";

/** A resolved, drawable corridor arc between two chokepoint nodes. */
export interface RouteArc {
  id: string;
  fromId: string;
  toId: string;
  /** [lat, lon] endpoint (centroid of the source profile's primary fence). */
  from: [number, number];
  /** [lat, lon] endpoint. */
  to: [number, number];
  label: string;
}

/**
 * Declared corridor legs as chokepoint id pairs. Maritime trade-lane order:
 * the transpacific leg (Asia -> North America) and the Asia-Europe leg via
 * Suez. Air and land profiles are intentionally absent (zero-leg nodes).
 */
export const ROUTE_LEGS: ReadonlyArray<readonly [string, string]> = [
  ["long-beach-approach", "singapore-malacca-approach"],
  ["singapore-malacca-approach", "suez-canal-approaches"],
];

/**
 * Vertex-mean centroid of a ring: a visual anchor, NOT a geometric claim
 * (the mean vertex of a concave ring may fall outside the polygon; that is
 * acceptable for an arc endpoint). Returns [lat, lon].
 */
export function centroidOfRing(ring: PolygonRing): [number, number] {
  if (ring.length === 0) throw new Error("centroidOfRing requires a non-empty ring");
  let lat = 0;
  let lon = 0;
  for (const [vLat, vLon] of ring) {
    lat += vLat;
    lon += vLon;
  }
  return [lat / ring.length, lon / ring.length];
}

/**
 * Primary fence selection — pinned to the exact rule used for camera framing
 * in main.ts `openInvestigation` (waiting-cohort ?? approach-flow ?? first)
 * so arcs and focus framing always agree on "the" fence of a profile.
 */
export function primaryFence(profile: ChokepointProfile): ChokepointProfile["geofences"][number] {
  return (
    profile.geofences.find((g) => g.purpose === "waiting-cohort") ??
    profile.geofences.find((g) => g.purpose === "approach-flow") ??
    profile.geofences[0]!
  );
}

function polygonRingOf(profile: ChokepointProfile): PolygonRing | null {
  const fence = primaryFence(profile);
  return fence.geometry.kind === "polygon" ? fence.geometry.ring : null;
}

/**
 * Resolve every declared leg into a drawable arc. Deterministic: registry
 * order and leg order are fixed. A leg whose endpoints lack reviewed polygon
 * geometry is skipped (never guessed) — placeholder geometry produces no arc.
 */
export function resolveRouteArcs(
  registry: readonly ChokepointProfile[] = CHOKEPOINT_REGISTRY,
  legs: ReadonlyArray<readonly [string, string]> = ROUTE_LEGS,
): RouteArc[] {
  const byId = new Map(registry.map((p) => [p.id, p]));
  const arcs: RouteArc[] = [];
  for (const [fromId, toId] of legs) {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) continue; // unknown profile: skip, never invent
    const fromRing = polygonRingOf(from);
    const toRing = polygonRingOf(to);
    if (!fromRing || !toRing) continue; // no reviewed polygon: skip honestly
    arcs.push({
      id: `route-${fromId}-${toId}`,
      fromId,
      toId,
      from: centroidOfRing(fromRing),
      to: centroidOfRing(toRing),
      label: `${from.name} — ${to.name} (illustrative corridor, not a tracked vessel path)`,
    });
  }
  return arcs;
}
