/**
 * Baseline comparison tests (§7, §8.4 COMPARISON claims, §3.3 data quality).
 */

import { describe, expect, it } from "vitest";
import { compareWithBaseline, BASELINE_COMPARISON_VERSION } from "../../src/analytics/baselines";
import type { DerivedMetric } from "../../src/analytics/metrics";

const mk = (overrides: Partial<DerivedMetric> = {}): DerivedMetric => ({
  metricId: "moving_fraction@scope@2026-09-09T14:00:00Z",
  metricType: "moving_fraction",
  scope: "scope",
  value: 0.5,
  unit: "fraction",
  computedAt: "2026-09-09T14:00:00Z",
  observationWindow: { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" },
  formulaVersion: "moving-fraction-v1",
  inputs: ["obs-1"],
  quality: { state: "fresh", sampleCount: 10, coverageNote: "test" },
  ...overrides,
});

describe("compareWithBaseline (§7)", () => {
  it("computes absolute and relative change with direction", () => {
    const r = compareWithBaseline(
      mk({ value: 0.6 }),
      mk({ value: 0.5, observationWindow: { startAt: "2026-09-09T10:00:00Z", endAt: "2026-09-09T12:00:00Z" } }),
      { computedAt: "2026-09-09T14:00:00Z" }
    );
    expect(r.absoluteChange).toBeCloseTo(0.1, 10);
    expect(r.relativeChange).toBeCloseTo(0.2, 10);
    expect(r.direction).toBe("increase");
    expect(r.comparison.formulaVersion).toBe(BASELINE_COMPARISON_VERSION);
    expect(r.comparison.metricType).toBe("baseline_comparison");
  });

  it("is a §5.5 metric with provenance pointing at BOTH parent metric ids", () => {
    const current = mk({ metricId: "cur-1", value: 0.4 });
    const baseline = mk({ metricId: "base-1", value: 0.5 });
    const r = compareWithBaseline(current, baseline, { computedAt: "2026-09-09T14:00:00Z" });
    expect(r.comparison.inputs).toEqual(["cur-1", "base-1"]);
    expect(r.comparison.value).toBeCloseTo(-0.2, 10);
    expect(r.direction).toBe("decrease");
  });

  it("requires the same metricType and unit", () => {
    expect(() =>
      compareWithBaseline(mk({ metricType: "vessel_count", unit: "entities" }), mk(), { computedAt: "x" })
    ).toThrow(/metricType/);
    expect(() => compareWithBaseline(mk({ unit: "entities" }), mk(), { computedAt: "x" })).toThrow(/unit/);
  });

  it("null on either side is UNKNOWN, not zero (§3.3)", () => {
    const r1 = compareWithBaseline(mk({ value: null }), mk(), { computedAt: "x" });
    expect(r1.direction).toBe("unknown");
    expect(r1.comparison.value).toBeNull();
    expect(r1.comparison.quality.state).toBe("unknown");
    const r2 = compareWithBaseline(mk(), mk({ value: null }), { computedAt: "x" });
    expect(r2.direction).toBe("unknown");
  });

  it("insufficient sample size returns LOW_SAMPLE/UNKNOWN (§3.3)", () => {
    const r = compareWithBaseline(
      mk({ quality: { state: "fresh", sampleCount: 2, coverageNote: "x" } }),
      mk(),
      { computedAt: "x", minSampleSize: 5 }
    );
    expect(r.direction).toBe("unknown");
    expect(r.comparison.quality.state).toBe("unknown");
    expect(r.comparison.quality.coverageNote).toMatch(/LOW_SAMPLE/);
  });

  it("zero baseline keeps absolute change but flags relative change as undefined", () => {
    const r = compareWithBaseline(mk({ value: 4, unit: "entities", metricType: "dwell_cohort_size" }), mk({ value: 0, unit: "entities", metricType: "dwell_cohort_size" }), { computedAt: "x" });
    expect(r.absoluteChange).toBe(4);
    expect(r.relativeChange).toBeNull();
    expect(r.direction).toBe("increase");
    expect(r.comparison.quality.coverageNote).toMatch(/relative change is undefined/);
  });

  it("small changes within the stability threshold are STABLE", () => {
    const r = compareWithBaseline(mk({ value: 0.52 }), mk({ value: 0.5 }), { computedAt: "x" });
    expect(r.direction).toBe("stable"); // +4% < 5% default
  });

  it("parent degraded state propagates to the comparison (never silently fresh, §3.1)", () => {
    const r = compareWithBaseline(mk(), mk({ quality: { state: "degraded", sampleCount: 10, coverageNote: "x" } }), { computedAt: "x" });
    expect(r.comparison.quality.state).toBe("degraded");
  });

  it("is deterministic for identical inputs", () => {
    const a = compareWithBaseline(mk({ value: 0.7 }), mk({ value: 0.4 }), { computedAt: "x" });
    const b = compareWithBaseline(mk({ value: 0.7 }), mk({ value: 0.4 }), { computedAt: "x" });
    expect(a).toEqual(b);
  });
});
