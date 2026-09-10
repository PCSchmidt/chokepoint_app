/**
 * FacilityMetric tests (ADR-0015, §3.1–3.3, §12.1): normalization rejects
 * invalid input (never clamps), dedupe/ordering are deterministic, and the
 * CBP fixture parses with honest SIMULATED provenance.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeFacilityMetric,
  dedupeFacilityMetrics,
  sortFacilityMetrics,
  facilityDuplicateKey,
} from "../../src/data/facilityMetric";
import { parseFixture } from "../../src/data/fixtureLoader";

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metricId: "sim-facility:cbp:240201:bridge:2026-09-10T07:36:42Z",
    facilityId: "cbp:240201:bridge",
    facilityType: "border-crossing",
    displayName: "El Paso - Bridge of the Americas (BOTA)",
    mode: "land",
    location: { latitude: 31.7576, longitude: -106.4444 },
    observedAt: "2026-09-10T07:36:42Z",
    receivedAt: "2026-09-10T07:36:42Z",
    measurements: [
      { laneGroup: "commercial_vehicle", metric: "wait_minutes", value: 3, statusLabel: "no delay" },
      { laneGroup: "commercial_vehicle", metric: "lanes_open", value: 2 },
    ],
    providerUpdateLabel: "At 8:00 am MDT",
    portStatus: "Open",
    source: { providerId: "cbp-bwt", endpointId: "bwt.cbp.gov/api/waittimes", licenseId: "public-domain-usg" },
    quality: { sourceState: "fresh" },
    ...overrides,
  };
}

describe("FacilityMetric normalization (ADR-0015, §3.3)", () => {
  it("accepts a valid record with all fields", () => {
    const r = normalizeFacilityMetric(validInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.metric.measurements).toHaveLength(2);
      expect(r.metric.mode).toBe("land");
      expect(r.metric.location).toEqual({ latitude: 31.7576, longitude: -106.4444 });    }
  });

  it("rejects non-finite and negative wait times — never clamped", () => {
    expect(normalizeFacilityMetric(validInput({
      measurements: [{ laneGroup: "commercial_vehicle", metric: "wait_minutes", value: -5 }],
    })).ok).toBe(false);
    expect(normalizeFacilityMetric(validInput({
      measurements: [{ laneGroup: "commercial_vehicle", metric: "wait_minutes", value: Number.NaN }],
    })).ok).toBe(false);
  });

  it("rejects invalid coordinates (never clamped)", () => {
    const r = normalizeFacilityMetric(validInput({ location: { latitude: 95, longitude: -106.44 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/never clamped/);
  });

  it("rejects unknown modes, lane groups, and metric types (closed vocabularies)", () => {
    expect(normalizeFacilityMetric(validInput({ mode: "sea" })).ok).toBe(false);
    expect(normalizeFacilityMetric(validInput({
      measurements: [{ laneGroup: "submarine", metric: "wait_minutes", value: 1 }],
    })).ok).toBe(false);
    expect(normalizeFacilityMetric(validInput({
      measurements: [{ laneGroup: "commercial_vehicle", metric: "vessel_count", value: 1 }],
    })).ok).toBe(false);
  });

  it("lanes_open must be an integer", () => {
    expect(normalizeFacilityMetric(validInput({
      measurements: [{ laneGroup: "commercial_vehicle", metric: "lanes_open", value: 2.5 }],
    })).ok).toBe(false);
  });

  it("empty measurements are rejected (a reading must measure something)", () => {
    expect(normalizeFacilityMetric(validInput({ measurements: [] })).ok).toBe(false);
  });

  it("observedAt cannot be after receivedAt", () => {
    const r = normalizeFacilityMetric(validInput({ receivedAt: "2026-09-10T07:00:00Z" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/after receivedAt/);
  });

  it("null measurements are UNKNOWN, never zero (§3.3)", () => {
    const r = normalizeFacilityMetric(validInput({
      measurements: [{ laneGroup: "commercial_vehicle", metric: "wait_minutes", value: null, statusLabel: "Update Pending" }],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metric.measurements[0]!.value).toBeNull();
  });
});

describe("dedupe + ordering (§12.1 deterministic)", () => {
  it("same facility+time+lanes dedupes to the latest receivedAt regardless of input order", () => {
    const a = normalizeFacilityMetric(validInput({ receivedAt: "2026-09-10T08:00:00Z" }));
    const b = normalizeFacilityMetric(validInput({ receivedAt: "2026-09-10T09:00:00Z", metricId: "m2" }));
    if (!a.ok || !b.ok) throw new Error("fixtures must normalize");
    expect(facilityDuplicateKey(a.metric)).toBe(facilityDuplicateKey(b.metric));
    const deduped = dedupeFacilityMetrics([a.metric, b.metric]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.receivedAt).toBe("2026-09-10T09:00:00Z");
  });

  it("sorts by observedAt then metricId, stable across input orders", () => {
    const m1 = normalizeFacilityMetric(validInput({ observedAt: "2026-09-10T08:00:00Z", receivedAt: "2026-09-10T08:30:00Z", metricId: "b" }));
    const m2 = normalizeFacilityMetric(validInput({ observedAt: "2026-09-10T07:00:00Z", receivedAt: "2026-09-10T07:30:00Z", metricId: "a" }));
    if (!m1.ok || !m2.ok) throw new Error("fixtures must normalize");
    expect(sortFacilityMetrics([m1.metric, m2.metric]).map((m) => m.metricId)).toEqual(["a", "b"]);
  });
});

describe("CBP fixture (§12.2 fixture-first, ADR-0013)", () => {
  const raw = JSON.parse(readFileSync("tests/fixtures/cbp-border-wait-el-paso.json", "utf-8"));
  const fixture = parseFixture(raw);

  it("parses both facilities with zero rejections", () => {
    expect(fixture.facilityMetrics).toHaveLength(2);
    expect(fixture.facilityRejected).toHaveLength(0);
    expect(fixture.observations).toHaveLength(0); // facility fixture, not entity data
  });

  it("carries SIMULATED provenance and never claims live (§3.1)", () => {
    expect(fixture.truthState).toBe("SIMULATED");
    for (const m of fixture.facilityMetrics) {
      expect(m.facilityId).toMatch(/^cbp:/);
      expect(m.source.providerId).toBe("cbp-bwt");
      expect(m.mode).toBe("land");
    }
  });

  it("exposes commercial wait_minutes + lanes_open for BOTA (the design-note target)", () => {
    const bota = fixture.facilityMetrics.find((m) => m.facilityId === "cbp:240201:bridge")!;
    const wait = bota.measurements.find((x) => x.laneGroup === "commercial_vehicle" && x.metric === "wait_minutes");
    const lanes = bota.measurements.find((x) => x.laneGroup === "commercial_vehicle" && x.metric === "lanes_open");
    expect(wait?.value).toBe(3); // from the real 2026-09-10 sample
    expect(lanes?.value).toBe(2);
  });
});
