/**
 * Render governor (CHOKEPOINT-PLAN.md §4.1 bounded cohorts, §12.5 overlay
 * budget, §9.2 src/scene/renderGovernor.ts).
 *
 * The overlay budget is a hard rule: a bounded, DETERMINISTIC subset of
 * candidates is rendered, never an unbounded pile. Selection is stable across
 * frames (same candidates in, same subset out) so nothing flickers or
 * thrashes as the clock ticks.
 *
 * Priority rule (v1, `render-governor-v1`): events first, then selected
 * entity, then newest observations — ties broken by stable id so the choice
 * never depends on input order.
 */

export const RENDER_GOVERNOR_VERSION = "render-governor-v1";

export interface OverlayCandidate {
  id: string;
  /** Higher wins a slot; computed by the caller from data (never the clock). */
  priority: number;
}

export interface CohortSelection<T extends OverlayCandidate> {
  /** The bounded, deterministic cohort (length <= maxCount). */
  selected: T[];
  /** How many candidates were considered. */
  considered: number;
  /** Candidates dropped by the budget (visible for "n more" labels, §4.1). */
  dropped: number;
  formulaVersion: string;
}

/**
 * Select at most maxCount candidates. Ordering: priority DESC, then id ASC —
 * a total order, so identical inputs always yield identical cohorts (§12.5
 * replay determinism). Priorities may tie; ids break ties deterministically.
 */
export function selectBoundedCohort<T extends OverlayCandidate>(
  candidates: readonly T[],
  maxCount: number,
): CohortSelection<T> {
  if (!Number.isInteger(maxCount) || maxCount < 0) {
    throw new Error("maxCount must be a non-negative integer");
  }
  const sorted = [...candidates].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    selected: sorted.slice(0, maxCount),
    considered: candidates.length,
    dropped: Math.max(0, candidates.length - maxCount),
    formulaVersion: RENDER_GOVERNOR_VERSION,
  };
}

/** Data-frame overlay budget (§12.5: bounded painted entries). */
export const OVERLAY_BUDGETS = {
  vesselPoints: 800,
  vesselLabels: 40,
  eventCards: 6,
  densityCells: 500,
} as const;

/**
 * Frame-stability check: a cohort is "stable" between frames when the selected
 * id sets are identical. Callers can use this to decide whether a re-render is
 * warranted (§12.5 idle render behavior).
 */
export function cohortsAreStable<T extends OverlayCandidate>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  if (a.length !== b.length) return false;
  const idsA = a.map((c) => c.id).sort();
  const idsB = b.map((c) => c.id).sort();
  return idsA.every((id, i) => id === idsB[i]);
}
