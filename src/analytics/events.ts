/**
 * Event detector (CHOKEPOINT-PLAN.md §2.2, §4.5, §12.3, §17 Phase 2).
 *
 * Deterministic, threshold-based detection of unusual movement/queue behavior
 * from component metrics vs named baselines. Version `event-detector-v1`.
 *
 * Design rules:
 *  - Events are DERIVED records with provenance (the metric and baseline ids).
 *    They carry NO explanatory text and NO causal claim — attaching
 *    explanations is the Phase 4 generator/evaluator's job (§8), and §14.4
 *    language rules apply to whatever is eventually said ABOUT them.
 *  - An event fires only when BOTH thresholds are met (relative AND absolute),
 *    so tiny baselines cannot produce noise (§12.3 minimum sample behavior).
 *  - UNKNOWN comparisons never fire.
 *  - Detection is explicit and bounded: rules are versioned records, not
 *    scattered conditionals (§4.3 data-driven configuration).
 */

import type { DerivedMetric } from "./metrics";
import { compareWithBaseline, type BaselineComparison } from "./baselines";

export const EVENT_DETECTOR_VERSION = "event-detector-v1";

export type EventType = "queue_buildup" | "stoppage" | "flow_surge" | "flow_drop";

export interface EventRule {
  eventType: EventType;
  /** Metric this rule watches. */
  metricType: "dwell_cohort_size" | "moving_fraction" | "entry_count";
  /** Which direction of change is "unusual" for this event type. */
  direction: "increase" | "decrease";
  /** Minimum |relative change| (fraction) to fire. */
  relativeThreshold: number;
  /** Minimum |absolute change| (in the metric's unit) to fire. */
  absoluteThreshold: number;
}

/**
 * Versioned default rules (§4.2 component metrics). Thresholds are starter
 * values for the demo; §12.3 calibration against known conditions is the
 * documented path to tuning them.
 */
export const DEFAULT_EVENT_RULES: readonly EventRule[] = [
  { eventType: "queue_buildup", metricType: "dwell_cohort_size", direction: "increase", relativeThreshold: 0.25, absoluteThreshold: 3 },
  { eventType: "stoppage", metricType: "moving_fraction", direction: "decrease", relativeThreshold: 0.2, absoluteThreshold: 0.05 },
  { eventType: "flow_surge", metricType: "entry_count", direction: "increase", relativeThreshold: 0.3, absoluteThreshold: 2 },
  { eventType: "flow_drop", metricType: "entry_count", direction: "decrease", relativeThreshold: 0.3, absoluteThreshold: 2 },
];

export interface DetectedEvent {
  eventId: string;
  eventType: EventType;
  /** Scope label (chokepoint/fence) the event was detected in. */
  scope: string;
  /** Caller-supplied detection time; the wall clock is never read. */
  detectedAt: string;
  currentWindow: { startAt: string; endAt: string };
  baselineWindow: { startAt: string; endAt: string };
  metricId: string;
  baselineMetricId: string;
  currentValue: number | null;
  baselineValue: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  quality: {
    state: "fresh" | "stale" | "degraded";
    coverageNote: string;
  };
  formulaVersion: string;
}

export interface DetectEventOptions {
  detectedAt: string;
  scope: string;
  /** Optional explicit comparison; computed from the pair when omitted. */
  comparison?: BaselineComparison | undefined;
  /**
   * Minimum accepted sample size on either side when the comparison is
   * computed here. Default 3: a one- or two-observation baseline cannot ground
   * an event claim (§3.3 LOW_SAMPLE; §12.3 minimum sample size behavior).
   */
  minSampleSize?: number | undefined;
}

/**
 * Evaluate one rule against a (current, baseline) metric pair.
 * Returns the DetectedEvent when the rule fires, otherwise null.
 */
export function evaluateEventRule(
  rule: EventRule,
  current: DerivedMetric,
  baseline: DerivedMetric,
  options: DetectEventOptions,
): DetectedEvent | null {
  if (current.metricType !== rule.metricType) {
    throw new Error(`rule ${rule.eventType} watches ${rule.metricType}, got ${current.metricType}`);
  }
  const comparison =
    options.comparison ??
    compareWithBaseline(current, baseline, {
      computedAt: options.detectedAt,
      minSampleSize: options.minSampleSize ?? 3,
    });
  const c = comparison.comparison;

  // UNKNOWN comparisons never fire (§3.3): missing values or LOW_SAMPLE.
  if (c.quality.state === "unknown") return null;
  if (comparison.direction === "unknown") return null;
  if (comparison.direction !== rule.direction) return null;

  const abs = comparison.absoluteChange ?? 0;
  const rel = comparison.relativeChange ?? Number.POSITIVE_INFINITY;
  if (Math.abs(abs) < rule.absoluteThreshold) return null;
  if (Math.abs(rel) < rule.relativeThreshold) return null;

  // Derive the source state from the parent metrics; unknown parents were
  // already excluded by the comparison state above.
  const state: DetectedEvent["quality"]["state"] =
    c.quality.state === "stale" ? "stale" : c.quality.state === "degraded" ? "degraded" : "fresh";

  return {
    eventId: `${rule.eventType}@${options.scope}@${current.observationWindow.startAt}`,
    eventType: rule.eventType,
    scope: options.scope,
    detectedAt: options.detectedAt,
    currentWindow: { ...current.observationWindow },
    baselineWindow: { ...baseline.observationWindow },
    metricId: current.metricId,
    baselineMetricId: baseline.metricId,
    currentValue: current.value,
    baselineValue: baseline.value,
    absoluteChange: comparison.absoluteChange,
    relativeChange: comparison.relativeChange,
    quality: {
      state,
      coverageNote:
        `fired: |delta|=${Math.abs(abs)} >= ${rule.absoluteThreshold} and |relative|=${Math.abs(rel).toFixed(3)} >= ` +
        `${rule.relativeThreshold}, direction ${comparison.direction}; thresholds from ${EVENT_DETECTOR_VERSION}`,
    },
    formulaVersion: EVENT_DETECTOR_VERSION,
  };
}

export interface MetricPair {
  current: DerivedMetric;
  baseline: DerivedMetric;
}

/**
 * Evaluate the default (or supplied) rules over a set of metric pairs for one
 * chokepoint scope. Only pairs whose metricType has a rule are considered;
 * pairs with UNKNOWN comparisons are silently skipped (they would not fire).
 */
export function detectChokepointEvents(
  scope: string,
  pairs: readonly MetricPair[],
  options: { detectedAt: string; rules?: readonly EventRule[]; minSampleSize?: number | undefined },
): DetectedEvent[] {
  const rules = options.rules ?? DEFAULT_EVENT_RULES;
  const events: DetectedEvent[] = [];
  for (const pair of pairs) {
    for (const rule of rules) {
      if (rule.metricType !== pair.current.metricType) continue;
      const event = evaluateEventRule(rule, pair.current, pair.baseline, {
        detectedAt: options.detectedAt,
        scope,
        minSampleSize: options.minSampleSize,
      });
      if (event !== null) events.push(event);
    }
  }
  return events;
}
