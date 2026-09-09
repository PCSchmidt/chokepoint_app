/**
 * Derived metric engine, first slice (CHOKEPOINT-PLAN.md §5.5, §7, §17 Phase 2).
 *
 * Implemented here (geofence-independent, deterministic, fixture-tested):
 *  - moving_fraction (§7.2): fraction of eligible observed entities whose
 *    accepted speed exceeds a documented threshold. A vessel with missing
 *    speed is NOT counted as stopped — it is excluded from the denominator
 *    and noted in coverage.
 *  - dwell_estimate (§7.4): per-entity duration between first and last
 *    accepted observation inside a scope, subject to minimum-observation and
 *    maximum-gap constraints, plus the waiting-cohort size.
 *
 * Geofence-bound metrics (vessel_count, entry/exit counts) require reviewed
 * geometry (ADR-0007) and are NOT implemented here. Dwell takes an injected
 * membership predicate so the metric engine stays independent of the geofence
 * registry; the registry plugs a versioned predicate in later.
 *
 * Every metric is a §5.5 DerivedMetric with a formula version, explicit
 * inputs, and quality metadata. Nothing invents a wall-clock time:
 * `computedAt` is always supplied by the caller (deterministic, testable).
 */

import type { TransportObservation } from "../data/observation";
import { provenanceForObservations, type ProvenanceRecord, FIXTURE_TRANSFORMATION_VERSION } from "../data/provenance";
import type { TruthState } from "../data/truthState";

/** The §5.5 derived metric model. */
export interface DerivedMetric {
  metricId: string;
  metricType: string;
  scope: string;
  value: number | null;
  unit: string;
  computedAt: string;
  observationWindow: { startAt: string; endAt: string };
  formulaVersion: string;
  inputs: string[];
  quality: {
    state: "fresh" | "stale" | "degraded" | "unknown";
    sampleCount: number;
    coverageNote: string;
    confidence?: number | undefined;
  };
}

export interface MetricWindow {
  startAt: string;
  endAt: string;
}

export interface MetricBaseOptions {
  /** ISO timestamp for provenance; never the wall clock. */
  computedAt: string;
  /** Truth state of the inputs (SIMULATED for fixtures, OBSERVED for live). */
  truthState: TruthState;
  /** Stable scope label, e.g. "all observed entities" or a geofence version id. */
  scope?: string;
  observationWindow: MetricWindow;
}

export const MOVING_FRACTION_FORMULA_VERSION = "moving-fraction-v1";
export const DWELL_FORMULA_VERSION = "dwell-estimate-v1";

function inWindow(o: TransportObservation, window: MetricWindow): boolean {
  return o.observedAt >= window.startAt && o.observedAt <= window.endAt;
}

function worstSourceState(observations: readonly TransportObservation[]): "fresh" | "degraded" | "stale" {
  let state: "fresh" | "degraded" | "stale" = "fresh";
  for (const o of observations) {
    if (o.quality.sourceState === "degraded" || o.quality.sourceState === "unavailable") return "degraded";
    if (o.quality.sourceState === "stale" && state === "fresh") state = "stale";
  }
  return state;
}

function metricId(metricType: string, computedAt: string, scope: string): string {
  return `${metricType}@${scope}@${computedAt}`;
}

/**
 * Build one provenance record per provider for the observations that fed a
 * metric (§3.2, §3.3). Conflicting multi-provider inputs yield one record per
 * provider instead of a merged one — conflicts stay visible.
 */
export function provenanceForMetricInputs(
  observations: readonly TransportObservation[],
  truthState: TruthState,
  transformationVersion: string = FIXTURE_TRANSFORMATION_VERSION,
): ProvenanceRecord[] {
  const groups = new Map<string, TransportObservation[]>();
  for (const o of observations) {
    const key = `${o.source.providerId}|${o.source.endpointId}`;
    const group = groups.get(key);
    if (group) group.push(o);
    else groups.set(key, [o]);
  }
  return [...groups.values()].map((group) => provenanceForObservations(group, truthState, transformationVersion));
}

function sortedCopy(observations: readonly TransportObservation[]): TransportObservation[] {
  return [...observations].sort((a, b) =>
    a.observedAt === b.observedAt
      ? a.entityId === b.entityId
        ? a.observationId.localeCompare(b.observationId)
        : a.entityId.localeCompare(b.entityId)
      : a.observedAt.localeCompare(b.observedAt)
  );
}

// ---------------------------------------------------------------------------
// Moving fraction (§7.2)
// ---------------------------------------------------------------------------

export interface MovingFractionOptions extends MetricBaseOptions {
  /** Documented speed threshold in knots (versioned with the formula). */
  speedKnotsThreshold: number;
  /** Restrict the metric to these entity ids (e.g. the freight cohort). */
  entityIds?: readonly string[] | undefined;
}

/**
 * Moving fraction v1: an entity is MOVING when its LATEST accepted speed
 * observation inside the window exceeds the threshold. Entities with no speed
 * observation are excluded from both numerator and denominator (never counted
 * as stopped — §7.2) and reported in the coverage note. With zero eligible
 * entities the value is null with quality state "unknown" (§3.3: insufficient
 * sample size is UNKNOWN, not a confident estimate).
 */
export function movingFraction(
  observations: readonly TransportObservation[],
  options: MovingFractionOptions,
): DerivedMetric {
  if (!(options.speedKnotsThreshold >= 0)) {
    throw new Error("speedKnotsThreshold must be a non-negative number");
  }
  const allowed = options.entityIds === undefined ? null : new Set(options.entityIds);
  const byEntity = new Map<string, TransportObservation[]>();
  for (const o of sortedCopy(observations)) {
    if (!inWindow(o, options.observationWindow)) continue;
    if (allowed !== null && !allowed.has(o.entityId)) continue;
    const list = byEntity.get(o.entityId);
    if (list) list.push(o);
    else byEntity.set(o.entityId, [o]);
  }

  let eligible = 0;
  let moving = 0;
  const missingSpeed: string[] = [];
  const inputs = new Set<string>();
  const contributing: TransportObservation[] = [];
  for (const entityId of [...byEntity.keys()].sort()) {
    const records = byEntity.get(entityId)!;
    const latest = records[records.length - 1]!;
    for (const o of records) inputs.add(o.observationId);
    contributing.push(...records);
    const speed = latest.kinematics.speedKnots;
    if (speed === undefined) {
      missingSpeed.push(entityId); // not counted as stopped; excluded (§7.2)
      continue;
    }
    eligible += 1;
    if (speed > options.speedKnotsThreshold) moving += 1;
  }

  const value = eligible === 0 ? null : moving / eligible;
  const scope = options.scope ?? "observed-entities";
  const coverageParts = [`${eligible} eligible entity(ies) with observed speed`];
  if (missingSpeed.length > 0) {
    coverageParts.push(
      `${missingSpeed.length} entity(ies) excluded: no speed observation in window (not counted as stopped, §7.2)`
    );
  }
  if (allowed !== null) coverageParts.push("restricted to the provided entity allowlist");

  return {
    metricId: metricId("moving_fraction", options.computedAt, scope),
    metricType: "moving_fraction",
    scope,
    value,
    unit: "fraction",
    computedAt: options.computedAt,
    observationWindow: { ...options.observationWindow },
    formulaVersion: MOVING_FRACTION_FORMULA_VERSION,
    inputs: [...inputs].sort(),
    quality: {
      state: eligible === 0 ? "unknown" : worstSourceState(contributing),
      sampleCount: eligible,
      coverageNote: coverageParts.join("; "),
    },
  };
}

// ---------------------------------------------------------------------------
// Dwell estimate (§7.4)
// ---------------------------------------------------------------------------

/** Membership predicate injected by the caller (geofence registry later). */
export type MembershipPredicate = (o: TransportObservation) => boolean;

export interface DwellOptions extends MetricBaseOptions {
  /** Membership rule for the scope (geofence, region bbox, test predicate). */
  membership: MembershipPredicate;
  /** An entity needs at least this many accepted in-scope observations. */
  minObservations: number;
  /** In-scope gaps larger than this split the entity's dwell (two visits). */
  maxGapSeconds: number;
  /** Restrict to these entity ids (e.g. the freight cohort). */
  entityIds?: readonly string[] | undefined;
}

export interface DwellEstimate {
  entityId: string;
  firstInsideAt: string;
  lastInsideAt: string;
  dwellSeconds: number;
  observationCount: number;
  largestGapSeconds: number;
  observationIds: string[];
}

export interface DwellResult {
  /** §7.4 per-entity dwell, only for entities meeting all constraints. */
  perEntity: DwellEstimate[];
  /** Waiting-cohort size (§4.2): entities meeting the dwell constraints. */
  cohortSize: DerivedMetric;
  /** Median dwell seconds across perEntity, or null if the cohort is empty. */
  medianDwellSeconds: DerivedMetric;
}

/**
 * Dwell estimate v1 (§7.4): for each entity, the duration between its first
 * and last accepted observation inside the scope within the window, provided
 * the entity has >= minObservations in-scope observations and no in-scope gap
 * exceeds maxGapSeconds (a too-long gap splits the visit; only the LONGEST
 * visit is kept, and the split is conservative — shorter visits are dropped,
 * never merged). This is not official port dwell time; callers must label it
 * as an estimate and show the inclusion rules.
 */
export function dwellEstimates(
  observations: readonly TransportObservation[],
  options: DwellOptions,
): DwellResult {
  if (!(options.minObservations >= 1)) throw new Error("minObservations must be >= 1");
  if (!(options.maxGapSeconds > 0)) throw new Error("maxGapSeconds must be positive");

  const allowed = options.entityIds === undefined ? null : new Set(options.entityIds);
  const byEntity = new Map<string, TransportObservation[]>();
  for (const o of sortedCopy(observations)) {
    if (!inWindow(o, options.observationWindow)) continue;
    if (allowed !== null && !allowed.has(o.entityId)) continue;
    if (!options.membership(o)) continue;
    const list = byEntity.get(o.entityId);
    if (list) list.push(o);
    else byEntity.set(o.entityId, [o]);
  }

  const perEntity: DwellEstimate[] = [];
  const inputs = new Set<string>();
  const contributing: TransportObservation[] = [];

  for (const entityId of [...byEntity.keys()].sort()) {
    const records = byEntity.get(entityId)!; // sorted, all in-scope, in window
    // Split into visits on gaps exceeding maxGapSeconds; keep the longest.
    const visits: TransportObservation[][] = [];
    let current: TransportObservation[] = [records[0]!];
    for (let i = 1; i < records.length; i++) {
      const gap = (Date.parse(records[i]!.observedAt) - Date.parse(records[i - 1]!.observedAt)) / 1000;
      if (gap > options.maxGapSeconds) {
        visits.push(current);
        current = [records[i]!];
      } else {
        current.push(records[i]!);
      }
    }
    visits.push(current);

    const best = visits.reduce((a, b) => (b.length > a.length ? b : a));
    if (best.length < options.minObservations) continue;
    const first = best[0]!;
    const last = best[best.length - 1]!;
    let largestGap = 0;
    for (let i = 1; i < best.length; i++) {
      largestGap = Math.max(
        largestGap,
        (Date.parse(best[i]!.observedAt) - Date.parse(best[i - 1]!.observedAt)) / 1000
      );
    }
    for (const o of best) inputs.add(o.observationId);
    contributing.push(...best);
    perEntity.push({
      entityId,
      firstInsideAt: first.observedAt,
      lastInsideAt: last.observedAt,
      dwellSeconds: (Date.parse(last.observedAt) - Date.parse(first.observedAt)) / 1000,
      observationCount: best.length,
      largestGapSeconds: largestGap,
      observationIds: best.map((o) => o.observationId),
    });
  }

  const scope = options.scope ?? "membership-predicate";
  const cohortSize: DerivedMetric = {
    metricId: metricId("dwell_cohort_size", options.computedAt, scope),
    metricType: "dwell_estimate",
    scope,
    value: perEntity.length,
    unit: "entities",
    computedAt: options.computedAt,
    observationWindow: { ...options.observationWindow },
    formulaVersion: DWELL_FORMULA_VERSION,
    inputs: [...inputs].sort(),
    quality: {
      state: perEntity.length === 0 ? "unknown" : worstSourceState(contributing),
      sampleCount: perEntity.length,
      coverageNote:
        `dwell = first-to-last accepted in-scope observation; >= ${options.minObservations} observations; ` +
        `in-scope gap <= ${options.maxGapSeconds}s. Not official port dwell time (§7.4).`,
    },
  };

  let medianSeconds: number | null = null;
  if (perEntity.length > 0) {
    const sortedDwell = perEntity.map((d) => d.dwellSeconds).sort((a, b) => a - b);
    const mid = Math.floor(sortedDwell.length / 2);
    medianSeconds =
      sortedDwell.length % 2 === 1 ? sortedDwell[mid]! : (sortedDwell[mid - 1]! + sortedDwell[mid]!) / 2;
  }
  const medianDwellSeconds: DerivedMetric = {
    metricId: metricId("dwell_median_seconds", options.computedAt, scope),
    metricType: "dwell_estimate",
    scope,
    value: medianSeconds,
    unit: "seconds",
    computedAt: options.computedAt,
    observationWindow: { ...options.observationWindow },
    formulaVersion: DWELL_FORMULA_VERSION,
    inputs: [...inputs].sort(),
    quality: {
      state: medianSeconds === null ? "unknown" : cohortSize.quality.state,
      sampleCount: perEntity.length,
      coverageNote: cohortSize.quality.coverageNote,
    },
  };

  return { perEntity, cohortSize, medianDwellSeconds };
}
