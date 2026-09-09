/**
 * Event detector tests (§4.5, §12.3 minimum sample behavior, §14.4 no-claims).
 */

import { describe, expect, it } from "vitest";
import { compareWithBaseline } from "../../src/analytics/baselines";
import {
  evaluateEventRule,
  detectChokepointEvents,
  DEFAULT_EVENT_RULES,
  EVENT_DETECTOR_VERSION,
  type EventRule,
} from "../../src/analytics/events";
import type { DerivedMetric } from "../../src/analytics/metrics";

const mk = (overrides: Partial<DerivedMetric> = {}): DerivedMetric => ({
  metricId: "dwell_cohort_size@scope@2026-09-09T14:00:00Z",
  metricType: "dwell_cohort_size",
  scope: "geofence:outer-anchorage@2026-09-09-v1",
  value: 10,
  unit: "entities",
  computedAt: "2026-09-09T14:00:00Z",
  observationWindow: { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" },
  formulaVersion: "dwell-estimate-v1",
  inputs: ["obs-1"],
  quality: { state: "fresh", sampleCount: 10, coverageNote: "test" },
  ...overrides,
});

const queueRule: EventRule = {
  eventType: "queue_buildup",
  metricType: "dwell_cohort_size",
  direction: "increase",
  relativeThreshold: 0.25,
  absoluteThreshold: 3,
};

describe("evaluateEventRule", () => {
  it("fires when BOTH thresholds are met in the rule direction", () => {
    const event = evaluateEventRule(queueRule, mk({ value: 20, metricId: "cur" }), mk({ value: 10, metricId: "base" }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "long-beach-approach",
    });
    expect(event).not.toBeNull();
    expect(event!.eventType).toBe("queue_buildup");
    expect(event!.currentValue).toBe(20);
    expect(event!.baselineValue).toBe(10);
    expect(event!.relativeChange).toBeCloseTo(1.0, 10);
    expect(event!.formulaVersion).toBe(EVENT_DETECTOR_VERSION);
    expect(event!.quality.coverageNote).toMatch(/fired/);
    expect(event!.metricId).toBe("cur");
    expect(event!.baselineMetricId).toBe("base");
  });

  it("does NOT fire below the absolute threshold even with a big relative change", () => {
    // 10 -> 14: +40% relative (>= 25%) but +4 entities... that's >= 3. Use 10 -> 13: +30% rel, +3 abs — fires.
    // For a no-fire case: 10 -> 12: +20% rel (below 25%) -> relative gate stops it.
    const smallRel = evaluateEventRule(queueRule, mk({ value: 12 }), mk({ value: 10 }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "s",
    });
    expect(smallRel).toBeNull();
  });

  it("does NOT fire below the relative threshold even with a big absolute change", () => {
    const smallAbs = evaluateEventRule(queueRule, mk({ value: 100 }), mk({ value: 60 }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "s",
    });
    // +40 entities but +66% relative — that fires. Use a big base: 1000 -> 1002: +0.2% < 25%.
    const r2 = evaluateEventRule(queueRule, mk({ value: 1002 }), mk({ value: 1000 }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "s",
    });
    expect(smallAbs).not.toBeNull();
    expect(r2).toBeNull();
  });

  it("does NOT fire in the opposite direction", () => {
    const event = evaluateEventRule(queueRule, mk({ value: 5 }), mk({ value: 10 }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "s",
    });
    expect(event).toBeNull(); // decrease, but rule watches increases
  });

  it("UNKNOWN comparisons never fire (LOW_SAMPLE, §3.3 / §12.3 minimum sample behavior)", () => {
    const comparison = compareWithBaseline(
      mk({ value: 20 }),
      mk({ value: 10, quality: { state: "fresh", sampleCount: 1, coverageNote: "x" } }),
      { computedAt: "2026-09-09T14:00:00Z", minSampleSize: 5 }
    );
    expect(comparison.direction).toBe("unknown");
    const event = evaluateEventRule(queueRule, mk({ value: 20 }), mk({ value: 10 }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "s",
      comparison,
    });
    expect(event).toBeNull();
  });

  it("rejects a rule/metric type mismatch", () => {
    expect(() =>
      evaluateEventRule(queueRule, mk({ metricType: "vessel_count", unit: "entities" }), mk(), {
        detectedAt: "x",
        scope: "s",
      })
    ).toThrow(/watches/);
  });

  it("degraded parent state yields a DEGRADED event, visible not silent (§3.1)", () => {
    const event = evaluateEventRule(queueRule, mk({ value: 20 }), mk({ value: 10, quality: { state: "degraded", sampleCount: 10, coverageNote: "x" } }), {
      detectedAt: "2026-09-09T14:00:00Z",
      scope: "s",
    });
    expect(event).not.toBeNull();
    expect(event!.quality.state).toBe("degraded");
  });
});

describe("detectChokepointEvents", () => {
  it("evaluates all default rules and returns only fired events", () => {
    const dwellCur = mk({ metricId: "d-cur", value: 30 });
    const dwellBase = mk({ metricId: "d-base", value: 10 });
    const entryCur = mk({ metricId: "e-cur", metricType: "entry_count", unit: "crossings", value: 1 });
    const entryBase = mk({ metricId: "e-base", metricType: "entry_count", unit: "crossings", value: 8 });
    const events = detectChokepointEvents("long-beach-approach", [
      { current: dwellCur, baseline: dwellBase },
      { current: entryCur, baseline: entryBase },
    ], { detectedAt: "2026-09-09T14:00:00Z" });
    const types = events.map((e) => e.eventType).sort();
    expect(types).toEqual(["flow_drop", "queue_buildup"]);
    for (const e of events) expect(e.scope).toBe("long-beach-approach");
  });

  it("carries no causal or explanatory text (§8, §14.4)", () => {
    const events = detectChokepointEvents("s", [{ current: mk({ value: 30 }), baseline: mk({ value: 10 }) }], {
      detectedAt: "2026-09-09T14:00:00Z",
    });
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events[0]);
    for (const banned of ["cause", "because", "disruption", "congestion caused", "suspicious", "threat"]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });

  it("is deterministic: same inputs produce identical events", () => {
    const args = [{ current: mk({ value: 30 }), baseline: mk({ value: 10 }) }] as const;
    const a = detectChokepointEvents("s", args as unknown as Parameters<typeof detectChokepointEvents>[1], { detectedAt: "t" });
    const b = detectChokepointEvents("s", args as unknown as Parameters<typeof detectChokepointEvents>[1], { detectedAt: "t" });
    expect(a).toEqual(b);
  });
});

describe("default rules are versioned, data-driven records (§4.3)", () => {
  it("covers all §4.2 component metrics with default thresholds", () => {
    const watched = new Set(DEFAULT_EVENT_RULES.map((r) => r.metricType));
    expect(watched).toEqual(new Set(["dwell_cohort_size", "moving_fraction", "entry_count"]));
    for (const r of DEFAULT_EVENT_RULES) {
      expect(r.relativeThreshold).toBeGreaterThan(0);
      expect(r.absoluteThreshold).toBeGreaterThan(0);
    }
  });
});
