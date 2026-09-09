/**
 * Analytics module boundary (CHOKEPOINT-PLAN.md §9.2, §17 Phase 2).
 *
 * Implemented (fixture-tested, deterministic): track segmentation, cohort
 * classification rules, moving fraction, dwell estimate, and (since geometry
 * v1, ADR-0011) the geofence-bound vessel_count and entry/exit counts.
 * Baselines/events/evidence bundles remain deferred (§17 roadmap).
 */

export * from "./tracks";
export * from "./observations";
export * from "./metrics";
