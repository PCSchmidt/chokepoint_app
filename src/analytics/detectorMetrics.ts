/**
 * Detector metrics (CHOKEPOINT-PLAN.md §12.3, §17 Phase 2 deliverable
 * "Evaluation report" groundwork).
 *
 * Deterministic evaluation of a detector run against labeled events:
 *   - precision, recall, F1
 *   - false positives per entity-hour (requires the labeled run to declare
 *     total entity-hours of observation)
 *   - detection latency (mean seconds from labeled onset to detection)
 *   - minimum sample size behavior is evaluated BEHAVIORALLY: comparisons in
 *     LOW_SAMPLE state cannot fire (tested in tests/evaluation), which is the
 *     §12.3 "minimum sample size behavior" contract.
 *
 * Matching rule: a detected event matches a labeled true event when eventType
 * AND scope are equal AND the detection time is within matchWindowSeconds of
 * the labeled onset (default 3600s). Unmatched detections are false positives;
 * unmatched labels are false negatives.
 */

import type { DetectedEvent, EventType } from "./events";

export const DETECTOR_METRICS_VERSION = "detector-metrics-v1";

export interface LabeledEvent {
  eventType: EventType;
  scope: string;
  /** True onset time of the labeled condition. */
  onsetAt: string;
}

export interface DetectorEvaluation {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Requires totalEntityHours > 0; null otherwise. */
  falsePositivesPerEntityHour: number | null;
  /** Mean seconds from labeled onset to detection over matched pairs; null if no matches. */
  meanDetectionLatencySeconds: number | null;
  formulaVersion: string;
}

export interface EvaluateDetectorOptions {
  /** Tolerance for matching a detection to a labeled onset (default 3600s). */
  matchWindowSeconds?: number;
  /** Total entity-hours of observation for the FP-rate denominator. */
  totalEntityHours?: number | undefined;
  /** Count of true no-event windows, for the trueNegatives figure (optional). */
  trueNegativeWindows?: number | undefined;
}

function parse(iso: string, what: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`invalid ${what} timestamp: ${iso}`);
  return t;
}

export function evaluateDetector(
  detected: readonly DetectedEvent[],
  labeled: readonly LabeledEvent[],
  options: EvaluateDetectorOptions = {},
): DetectorEvaluation {
  const matchWindow = options.matchWindowSeconds ?? 3600;

  // Greedy one-to-one matching: for each labeled event, the closest detection
  // of the same type+scope inside the window; each detection is consumed once.
  const available = [...detected];
  const latencies: number[] = [];
  let tp = 0;
  for (const label of labeled) {
    const onset = parse(label.onsetAt, "onsetAt");
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < available.length; i++) {
      const d = available[i]!;
      if (d.eventType !== (label as LabeledEvent).eventType) continue;
      if (d.scope !== label.scope) continue;
      const distance = Math.abs(parse(d.detectedAt, "detectedAt") - onset) / 1000;
      if (distance <= matchWindow && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      tp += 1;
      latencies.push(bestDistance);
      available.splice(bestIndex, 1);
    }
  }
  const fp = available.length;
  const fn = labeled.length - tp;
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: options.trueNegativeWindows ?? 0,
    precision,
    recall,
    f1,
    falsePositivesPerEntityHour:
      options.totalEntityHours && options.totalEntityHours > 0 ? fp / options.totalEntityHours : null,
    meanDetectionLatencySeconds:
      latencies.length === 0 ? null : latencies.reduce((a, b) => a + b, 0) / latencies.length,
    formulaVersion: DETECTOR_METRICS_VERSION,
  };
}
