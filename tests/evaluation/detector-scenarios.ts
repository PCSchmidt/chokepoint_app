/**
 * Labeled detector-evaluation scenarios (§12.6 dataset manifest).
 *
 * SIMULATED, deterministic, and SHARED: the vitest evaluation suite and
 * scripts/run-evaluation.ts consume this exact module, so the committed report
 * is reproducible from the same data the tests assert against.
 *
 * Ground truth labels (human-documented):
 *   A: queue_buildup TRUE  (cohort 10 -> 30; +200%, +20 entities)
 *   B: no event            (cohort 10 -> 11; +10%, below both thresholds)
 *   C: stoppage TRUE       (moving_fraction 0.9 -> 0.5; -44%, -0.4)
 *   D: flow_surge TRUE     (entry_count 2 -> 8; +300%, +6)
 *   E: labeled TRUE but the baseline has ONE observation: the detector must
 *      refuse to fire (LOW_SAMPLE, §3.3). Recorded as a false negative in the
 *      metrics; this is the documented known failure and it is deliberate.
 */

import type { DerivedMetric } from "../../src/analytics/metrics";
import type { LabeledEvent } from "../../src/analytics/detectorMetrics";

export const EVALUATION_CLOCK = "2026-09-09T16:00:00Z";
export const EVALUATION_SCOPE = "long-beach-approach";
export const BASELINE_WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" };
export const CURRENT_WINDOW = { startAt: "2026-09-09T14:00:00Z", endAt: "2026-09-09T16:00:00Z" };

const mk = (
  metricType: DerivedMetric["metricType"],
  metricId: string,
  value: number | null,
  unit: string,
  window: { startAt: string; endAt: string },
  sampleCount: number,
  state: DerivedMetric["quality"]["state"] = "fresh"
): DerivedMetric => ({
  metricId,
  metricType,
  scope: "geofence:outer-anchorage@2026-09-09-v1",
  value,
  unit,
  computedAt: EVALUATION_CLOCK,
  observationWindow: { ...window },
  formulaVersion:
    metricType === "dwell_cohort_size"
      ? "dwell-estimate-v1"
      : metricType === "moving_fraction"
        ? "moving-fraction-v1"
        : "entry-exit-v1",
  inputs: ["synthetic-inputs"],
  quality: { state, sampleCount, coverageNote: "evaluation scenario" },
});

export interface EvaluationScenario {
  scenarioId: string;
  label: "event" | "none";
  expectedEventType: string | null;
  note: string;
  current: DerivedMetric;
  baseline: DerivedMetric;
}

export const EVALUATION_SCENARIOS: readonly EvaluationScenario[] = [
  {
    scenarioId: "A",
    label: "event",
    expectedEventType: "queue_buildup",
    note: "cohort 10 -> 30 (+200%, +20 entities): true queue buildup",
    current: mk("dwell_cohort_size", "A-cur", 30, "entities", CURRENT_WINDOW, 30),
    baseline: mk("dwell_cohort_size", "A-base", 10, "entities", BASELINE_WINDOW, 30),
  },
  {
    scenarioId: "B",
    label: "none",
    expectedEventType: null,
    note: "cohort 10 -> 11 (+10%): stable, below both thresholds",
    current: mk("dwell_cohort_size", "B-cur", 11, "entities", CURRENT_WINDOW, 30),
    baseline: mk("dwell_cohort_size", "B-base", 10, "entities", BASELINE_WINDOW, 30),
  },
  {
    scenarioId: "C",
    label: "event",
    expectedEventType: "stoppage",
    note: "moving_fraction 0.9 -> 0.5 (-44%, -0.4): mass stoppage",
    current: mk("moving_fraction", "C-cur", 0.5, "fraction", CURRENT_WINDOW, 12),
    baseline: mk("moving_fraction", "C-base", 0.9, "fraction", BASELINE_WINDOW, 12),
  },
  {
    scenarioId: "D",
    label: "event",
    expectedEventType: "flow_surge",
    note: "entry_count 2 -> 8 (+300%, +6): arrivals surge",
    current: mk("entry_count", "D-cur", 8, "crossings", CURRENT_WINDOW, 8),
    baseline: mk("entry_count", "D-base", 2, "crossings", BASELINE_WINDOW, 8),
  },
  {
    scenarioId: "E",
    label: "event",
    expectedEventType: "queue_buildup",
    note: "KNOWN FAILURE: real queue (5 -> 30) but the baseline window has ONE observation; the detector refuses (LOW_SAMPLE). Deliberate false negative.",
    current: mk("dwell_cohort_size", "E-cur", 30, "entities", CURRENT_WINDOW, 30),
    baseline: mk("dwell_cohort_size", "E-base", 5, "entities", BASELINE_WINDOW, 1),
  },
];

/** Labeled truth: onsets sit within the default 1h match window of the clock. */
export const EVALUATION_LABELS: readonly LabeledEvent[] = [
  { eventType: "queue_buildup", scope: EVALUATION_SCOPE, onsetAt: "2026-09-09T15:30:00Z" },
  { eventType: "queue_buildup", scope: EVALUATION_SCOPE, onsetAt: "2026-09-09T15:40:00Z" }, // scenario E -> FN
  { eventType: "stoppage", scope: EVALUATION_SCOPE, onsetAt: "2026-09-09T15:20:00Z" },
  { eventType: "flow_surge", scope: EVALUATION_SCOPE, onsetAt: "2026-09-09T15:50:00Z" },
];

/** True no-event windows (scenario B; scenario E is labeled TRUE). */
export const TRUE_NEGATIVE_WINDOWS = 1;

/** Total entity-hours of simulated observation (for FP-rate normalization). */
export const TOTAL_ENTITY_HOURS = 60;
