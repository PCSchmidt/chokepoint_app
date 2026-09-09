/**
 * Detector evaluation suite (§12.3, §12.6; §20 step 8: first evaluation before
 * any LLM). Consumes the shared labeled scenarios module; scripts/run-evaluation.ts
 * regenerates the committed report from the SAME data, so the report and these
 * assertions can never drift apart.
 */

import { describe, expect, it } from "vitest";
import { compareWithBaseline } from "../../src/analytics/baselines";
import { detectChokepointEvents, type DetectedEvent } from "../../src/analytics/events";
import { evaluateDetector } from "../../src/analytics/detectorMetrics";
import {
  EVALUATION_SCENARIOS,
  EVALUATION_LABELS,
  EVALUATION_CLOCK,
  EVALUATION_SCOPE,
  TRUE_NEGATIVE_WINDOWS,
  TOTAL_ENTITY_HOURS,
} from "./detector-scenarios";

describe("detector evaluation (§12.3)", () => {
  const events = detectChokepointEvents(EVALUATION_SCOPE, EVALUATION_SCENARIOS, {
    detectedAt: EVALUATION_CLOCK,
  });

  it("fires the three true conditions and refuses the two non-events", () => {
    expect(events.map((e) => e.eventType).sort()).toEqual(["flow_surge", "queue_buildup", "stoppage"]);
  });

  it("LOW_SAMPLE baselines never fire even for real conditions (§3.3, scenario E)", () => {
    const e = EVALUATION_SCENARIOS.find((s) => s.scenarioId === "E")!;
    const comparison = compareWithBaseline(e.current, e.baseline, {
      computedAt: EVALUATION_CLOCK,
      minSampleSize: 3,
    });
    expect(comparison.direction).toBe("unknown");
    expect(comparison.comparison.quality.coverageNote).toMatch(/LOW_SAMPLE/);
    const queueEvents = events.filter((ev) => ev.eventType === "queue_buildup");
    expect(queueEvents).toHaveLength(1); // only scenario A
  });

  it("every fired event is deterministic and carries provenance, no causal text", () => {
    for (const e of events) {
      expect(e.eventId).toBe(`${e.eventType}@${EVALUATION_SCOPE}@${e.currentWindow.startAt}`);
      expect(e.formulaVersion).toBe("event-detector-v1");
      expect(e.baselineMetricId).toBeTruthy();
      expect(JSON.stringify(e).toLowerCase()).not.toContain("because");
    }
    expect(detectChokepointEvents(EVALUATION_SCOPE, EVALUATION_SCENARIOS, { detectedAt: EVALUATION_CLOCK })).toEqual(events);
  });

  it("computes §12.3 precision/recall/F1 against the labeled truth", () => {
    const evaluation = evaluateDetector(events, EVALUATION_LABELS, {
      matchWindowSeconds: 3600,
      totalEntityHours: TOTAL_ENTITY_HOURS,
      trueNegativeWindows: TRUE_NEGATIVE_WINDOWS,
    });
    // TP = A, C, D; FN = scenario E label (LOW_SAMPLE refusal, by design); FP = 0.
    expect(evaluation.truePositives).toBe(3);
    expect(evaluation.falseNegatives).toBe(1);
    expect(evaluation.falsePositives).toBe(0);
    expect(evaluation.precision).toBe(1);
    expect(evaluation.recall).toBeCloseTo(0.75, 10);
    expect(evaluation.f1).toBeCloseTo(0.857142857, 6);
    expect(evaluation.falsePositivesPerEntityHour).toBe(0);
    expect(evaluation.meanDetectionLatencySeconds).toBeGreaterThan(0);
    expect(evaluation.formulaVersion).toBe("detector-metrics-v1");
  });

  it("counts false positives and degrades precision when the detector over-fires", () => {
    const stray: DetectedEvent = {
      ...events[0]!,
      eventId: `queue_buildup@${EVALUATION_SCOPE}@2026-09-09T20:00:00Z`,
      currentWindow: { startAt: "2026-09-09T20:00:00Z", endAt: "2026-09-09T22:00:00Z" },
    };
    const labeled = EVALUATION_LABELS.filter((l) => l.eventType !== "queue_buildup" || l.onsetAt !== "2026-09-09T15:40:00Z");
    const withStray = evaluateDetector([...events, stray], labeled, { matchWindowSeconds: 3600 });
    expect(withStray.falsePositives).toBe(1);
    expect(withStray.precision).toBeCloseTo(3 / 4, 10);
  });
});
