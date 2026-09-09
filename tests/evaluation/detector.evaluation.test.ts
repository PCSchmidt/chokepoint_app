/**
 * Detector evaluation suite (CHOKEPOINT-PLAN.md §12.3, §17 Phase 2
 * "Evaluation report" groundwork; §20 step 8: first evaluation before any LLM).
 *
 * A labeled, deterministic scenario suite: five SIMULATED two-window scenarios
 * with human-labeled ground truth. The detector runs over the same component
 * metrics a live run would produce, and §12.3 metrics are computed and
 * asserted. This file is the reproducible evaluation command's core; the full
 * report generation arrives with the §12.6 artifacts task.
 *
 * Labeling ground truth (deliberate, documented):
 *   A: queue_buildup TRUE  (cohort 10 -> 30, +200% / +20 entities)
 *   B: none                (cohort 10 -> 11, +10% — below both thresholds)
 *   C: stoppage TRUE       (moving_fraction 0.9 -> 0.5, -44% / -0.4)
 *   D: flow_surge TRUE     (entry_count 2 -> 8, +300% / +6)
 *   E: none, but labeled TRUE on a TOO-SMALL sample (LOW_SAMPLE must NOT fire)
 *      -> this produces one false NEGATIVE by design: the detector correctly
 *      refuses to fire on an insufficient baseline; the label records what a
 *      human judged to be a real queue, which the detector must not claim.
 */

import { describe, expect, it } from "vitest";
import { compareWithBaseline } from "../../src/analytics/baselines";
import { detectChokepointEvents, type DetectedEvent } from "../../src/analytics/events";
import { evaluateDetector, type LabeledEvent } from "../../src/analytics/detectorMetrics";
import type { DerivedMetric } from "../../src/analytics/metrics";

const COMPUTED_AT = "2026-09-09T16:00:00Z";
const SCOPE = "long-beach-approach";

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
  scope: `geofence:outer-anchorage@2026-09-09-v1`,
  value,
  unit,
  computedAt: COMPUTED_AT,
  observationWindow: { ...window },
  formulaVersion: metricType === "dwell_cohort_size" ? "dwell-estimate-v1" : metricType === "moving_fraction" ? "moving-fraction-v1" : "entry-exit-v1",
  inputs: ["synthetic-inputs"],
  quality: { state, sampleCount, coverageNote: "evaluation scenario" },
});

const BASELINE_WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" };
const CURRENT_WINDOW = { startAt: "2026-09-09T14:00:00Z", endAt: "2026-09-09T16:00:00Z" };

const scenarios = {
  A: {
    current: mk("dwell_cohort_size", "A-cur", 30, "entities", CURRENT_WINDOW, 30),
    baseline: mk("dwell_cohort_size", "A-base", 10, "entities", BASELINE_WINDOW, 30),
  },
  B: {
    current: mk("dwell_cohort_size", "B-cur", 11, "entities", CURRENT_WINDOW, 30),
    baseline: mk("dwell_cohort_size", "B-base", 10, "entities", BASELINE_WINDOW, 30),
  },
  C: {
    current: mk("moving_fraction", "C-cur", 0.5, "fraction", CURRENT_WINDOW, 12),
    baseline: mk("moving_fraction", "C-base", 0.9, "fraction", BASELINE_WINDOW, 12),
  },
  D: {
    current: mk("entry_count", "D-cur", 8, "crossings", CURRENT_WINDOW, 8),
    baseline: mk("entry_count", "D-base", 2, "crossings", BASELINE_WINDOW, 8),
  },
  E: {
    // Real queue, but the baseline window had too few samples: must NOT fire.
    current: mk("dwell_cohort_size", "E-cur", 30, "entities", CURRENT_WINDOW, 30),
    baseline: mk("dwell_cohort_size", "E-base", 5, "entities", BASELINE_WINDOW, 1),
  },
};

function runDetector(): DetectedEvent[] {
  return detectChokepointEvents(SCOPE, Object.values(scenarios), { detectedAt: COMPUTED_AT });
}

describe("detector evaluation (§12.3)", () => {
  const events = runDetector();

  it("fires the three true conditions and refuses the two non-events", () => {
    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(["flow_surge", "queue_buildup", "stoppage"]);
  });

  it("LOW_SAMPLE baselines never fire even for real conditions (§3.3)", () => {
    // The DETECTOR's default sample floor (3) is what protects events; verify
    // both the comparison-level and detector-level behavior.
    const comparison = compareWithBaseline(scenarios.E.current, scenarios.E.baseline, {
      computedAt: COMPUTED_AT,
      minSampleSize: 3,
    });
    expect(comparison.direction).toBe("unknown");
    expect(comparison.comparison.quality.coverageNote).toMatch(/LOW_SAMPLE/);
    // Scenario E's current/baseline pair is included in the run above; the
    // absence of a second queue_buildup event proves the refusal.
    const queueEvents = events.filter((e) => e.eventType === "queue_buildup");
    expect(queueEvents).toHaveLength(1); // only scenario A
  });

  it("every fired event is deterministic and carries provenance", () => {
    for (const e of events) {
      expect(e.eventId).toBe(`${e.eventType}@${SCOPE}@${e.currentWindow.startAt}`);
      expect(e.formulaVersion).toBe("event-detector-v1");
      expect(e.baselineMetricId).toBeTruthy();
      // No causal language anywhere in the event (§14.4).
      expect(JSON.stringify(e).toLowerCase()).not.toContain("because");
    }
    expect(runDetector()).toEqual(events);
  });

  it("computes §12.3 precision/recall/F1 against the labeled truth", () => {
    const labeled: LabeledEvent[] = [
      { eventType: "queue_buildup", scope: SCOPE, onsetAt: "2026-09-09T15:30:00Z" },
      { eventType: "queue_buildup", scope: SCOPE, onsetAt: "2026-09-09T15:40:00Z" }, // scenario E: labeled TRUE, detector refuses (LOW_SAMPLE) -> FN
      { eventType: "stoppage", scope: SCOPE, onsetAt: "2026-09-09T15:20:00Z" },
      { eventType: "flow_surge", scope: SCOPE, onsetAt: "2026-09-09T15:50:00Z" },
    ];
    const evaluation = evaluateDetector(events, labeled, {
      matchWindowSeconds: 3600,
      totalEntityHours: 60,
      trueNegativeWindows: 1, // scenario B is a true no-event window
    });
    // TP = A, C, D detections; FN = scenario E label; FP = 0.
    expect(evaluation.truePositives).toBe(3);
    expect(evaluation.falseNegatives).toBe(1);
    expect(evaluation.falsePositives).toBe(0);
    expect(evaluation.precision).toBe(1);
    expect(evaluation.recall).toBeCloseTo(0.75, 10);
    expect(evaluation.f1).toBeCloseTo(0.857142857, 6);
    expect(evaluation.falsePositivesPerEntityHour).toBe(0);
    // Latency: labeled onsets are 10-70 min after window end; detection is at 16:00.
    expect(evaluation.meanDetectionLatencySeconds).toBeGreaterThan(0);
    expect(evaluation.formulaVersion).toBe("detector-metrics-v1");
  });

  it("counts false positives and degrades precision when the detector over-fires", () => {
    const overFired: DetectedEvent[] = [
      ...events,
      {
        ...events[0]!,
        eventId: "queue_buildup@long-beach-approach@2026-09-09T14:05:00Z",
        currentWindow: { startAt: "2026-09-09T14:05:00Z", endAt: "2026-09-09T16:00:00Z" },
      },
    ];
    const labeled: LabeledEvent[] = [
      { eventType: "queue_buildup", scope: SCOPE, onsetAt: "2026-09-09T15:30:00Z" },
      { eventType: "stoppage", scope: SCOPE, onsetAt: "2026-09-09T15:20:00Z" },
      { eventType: "flow_surge", scope: SCOPE, onsetAt: "2026-09-09T15:50:00Z" },
    ];
    void overFired; // superseded by the stray-detection case below
    // A duplicate detection inside the same match window is consumed by the
    // closest-match pairing; to exercise a real FP, use a detection outside
    // all labeled windows.
    const stray: DetectedEvent = {
      ...events[0]!,
      eventId: "queue_buildup@long-beach-approach@2026-09-09T20:00:00Z",
      currentWindow: { startAt: "2026-09-09T20:00:00Z", endAt: "2026-09-09T22:00:00Z" },
    };
    const withStray = evaluateDetector([...events, stray], labeled, { matchWindowSeconds: 3600 });
    expect(withStray.falsePositives).toBe(1);
    expect(withStray.precision).toBeCloseTo(3 / 4, 10);
  });
});
