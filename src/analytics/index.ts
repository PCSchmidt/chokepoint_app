/**
 * Analytics module boundary (CHOKEPOINT-PLAN.md §9.2, §17 Phase 2).
 *
 * Implemented (fixture-tested, deterministic): track segmentation, cohort
 * classification rules, moving fraction, dwell estimate. Geofence-bound
 * metrics (vessel_count, entry/exit) and baselines/events/evidence bundles
 * remain deferred (ADR-0007; §17 roadmap).
 */

export * from "./tracks";
export * from "./observations";
export * from "./metrics";
