/**
 * Baseline comparison (CHOKEPOINT-PLAN.md §7, §8.4 COMPARISON claims, §17 Phase 2).
 *
 * Compares a current-window component metric against the same metric from a
 * named, prior comparable window. The comparison is itself a §5.5
 * DerivedMetric so it carries provenance (the two metric ids it is derived
 * from), a formula version, and quality metadata.
 *
 * Rules honored here:
 *  - Only like metrics compare: same metricType AND same unit, else throw.
 *  - Insufficient sample size returns UNKNOWN (LOW_SAMPLE), never a confident
 *    estimate (§3.3).
 *  - Missing values are missing: a null on either side makes the comparison
 *    UNKNOWN, not zero (§3.3).
 *  - A near-zero baseline makes relative change undefined (documented), while
 *    absolute change stays meaningful.
 *  - The wall clock is never read: `computedAt` is caller-supplied.
 */

import type { DerivedMetric } from "./metrics";

export const BASELINE_COMPARISON_VERSION = "baseline-comparison-v1";

export interface BaselineComparisonOptions {
  computedAt: string;
  /** Minimum accepted sample size on EITHER side; below this the comparison is LOW_SAMPLE/UNKNOWN (§3.3). */
  minSampleSize?: number;
  /** |relativeChange| below this is "stable" (default 0.05 = 5%). */
  stableRelativeThreshold?: number;
  /** Stable scope label for the comparison metric. */
  scope?: string;
}

export interface BaselineComparison {
  /** §5.5 metric of type "baseline_comparison"; value = relative change (fraction). */
  comparison: DerivedMetric;
  absoluteChange: number | null;
  relativeChange: number | null;
  direction: "increase" | "decrease" | "stable" | "unknown";
}

function worstState(a: DerivedMetric["quality"]["state"], b: DerivedMetric["quality"]["state"]): DerivedMetric["quality"]["state"] {
  const order: DerivedMetric["quality"]["state"][] = ["fresh", "stale", "degraded", "unknown"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export function compareWithBaseline(
  current: DerivedMetric,
  baseline: DerivedMetric,
  options: BaselineComparisonOptions,
): BaselineComparison {
  if (current.metricType !== baseline.metricType) {
    throw new Error(
      `baseline comparison requires the same metricType (got ${current.metricType} vs ${baseline.metricType})`
    );
  }
  if (current.unit !== baseline.unit) {
    throw new Error(`baseline comparison requires the same unit (got ${current.unit} vs ${baseline.unit})`);
  }

  const minSampleSize = options.minSampleSize ?? 1;
  const stableThreshold = options.stableRelativeThreshold ?? 0.05;

  const bothPresent = current.value !== null && baseline.value !== null;
  const lowSample =
    current.quality.sampleCount < minSampleSize || baseline.quality.sampleCount < minSampleSize;

  const absoluteChange = bothPresent && current.value !== null && baseline.value !== null
    ? current.value - baseline.value
    : null;
  const relativeChange =
    absoluteChange !== null && baseline.value !== null && baseline.value !== 0
      ? absoluteChange / Math.abs(baseline.value)
      : null;

  let direction: BaselineComparison["direction"];
  if (!bothPresent || lowSample) {
    direction = "unknown";
  } else if (relativeChange === null) {
    // Baseline is exactly zero: only absolute change is meaningful.
    direction = absoluteChange !== null && absoluteChange > 0 ? "increase" : absoluteChange !== null && absoluteChange < 0 ? "decrease" : "stable";
  } else if (Math.abs(relativeChange) < stableThreshold) {
    direction = "stable";
  } else {
    direction = relativeChange > 0 ? "increase" : "decrease";
  }

  const notes: string[] = [
    `comparison of ${current.metricType} vs named baseline window ${baseline.observationWindow.startAt}..${baseline.observationWindow.endAt}`,
  ];
  if (relativeChange === null && bothPresent) {
    notes.push("baseline value is zero; relative change is undefined, absolute change remains meaningful");
  }
  if (lowSample) {
    notes.push(
      `LOW_SAMPLE: sample size ${current.quality.sampleCount} (current) / ${baseline.quality.sampleCount} (baseline) below minimum ${minSampleSize} (§3.3)`
    );
  }

  const scope = options.scope ?? `${current.scope} vs baseline`;
  const comparison: DerivedMetric = {
    metricId: `baseline_comparison@${scope}@${options.computedAt}`,
    metricType: "baseline_comparison",
    scope,
    value: relativeChange,
    unit: "fraction",
    computedAt: options.computedAt,
    observationWindow: { ...current.observationWindow },
    formulaVersion: BASELINE_COMPARISON_VERSION,
    inputs: [current.metricId, baseline.metricId],
    quality: {
      state: !bothPresent || lowSample ? "unknown" : worstState(current.quality.state, baseline.quality.state),
      sampleCount: Math.min(current.quality.sampleCount, baseline.quality.sampleCount),
      coverageNote: notes.join("; "),
    },
  };

  return { comparison, absoluteChange, relativeChange, direction };
}
