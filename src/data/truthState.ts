/**
 * Truth-state vocabulary (CHOKEPOINT-PLAN.md §3.1).
 *
 * These are the ONLY semantic states allowed anywhere in Chokepoint. Simulated
 * data is a first-class state that must stay visibly separate from observed
 * data in every surface: fixtures, metrics, UI badges, and generated claims.
 */

/** Semantic truth state of any value in the system. */
export const TRUTH_STATES = ["OBSERVED", "DERIVED", "SIMULATED", "UNKNOWN"] as const;
export type TruthState = (typeof TRUTH_STATES)[number];

/** Orthogonal source health states (§3.1). A value can be DERIVED + DEGRADED. */
export const HEALTH_STATES = ["FRESH", "STALE", "DEGRADED", "UNAVAILABLE", "NEVER_ANSWERED"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export function isTruthState(v: unknown): v is TruthState {
  return typeof v === "string" && (TRUTH_STATES as readonly string[]).includes(v);
}

export function isHealthState(v: unknown): v is HealthState {
  return typeof v === "string" && (HEALTH_STATES as readonly string[]).includes(v);
}
