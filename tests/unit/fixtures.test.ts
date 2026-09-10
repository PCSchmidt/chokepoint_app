/**
 * Fixture loader tests (CHOKEPOINT-PLAN.md §6.2, §12.2): every fixture must be
 * hard-labeled SIMULATED, and scenario metadata must match the parsed data.
 */

import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { parseFixture, REQUIRED_FIXTURE_TRUTH_STATE } from "../../src/data/fixtureLoader";
import { loadFixtureDirectory } from "../../src/data/fixtureLoader.node";
import { dedupeObservations } from "../../src/data/observation";

const fixturesDir = path.resolve("tests/fixtures");

describe("fixture provenance guard", () => {
  it("rejects a manifest whose truthState is not exactly SIMULATED", () => {
    const manifest = {
      fixtureId: "bad",
      truthState: "OBSERVED",
      simulated: true,
      description: "must fail",
      provenance: { generatedBy: "x", providerId: "simulated-x", licenseId: "CC0-1.0-synthetic" },
      observations: [],
    };
    expect(() => parseFixture(manifest)).toThrow(/SIMULATED/);
  });

  it("rejects a manifest without simulated:true", () => {
    const manifest = {
      fixtureId: "bad",
      truthState: "SIMULATED",
      simulated: false,
      description: "must fail",
      provenance: { generatedBy: "x", providerId: "simulated-x", licenseId: "CC0-1.0-synthetic" },
      observations: [],
    };
    expect(() => parseFixture(manifest)).toThrow(/simulated/);
  });

  it("rejects a manifest whose providerId does not start with 'simulated'", () => {
    const manifest = {
      fixtureId: "bad",
      truthState: "SIMULATED",
      simulated: true,
      description: "must fail",
      provenance: { generatedBy: "x", providerId: "aisstream-live", licenseId: "CC0-1.0-synthetic" },
      observations: [],
    };
    expect(() => parseFixture(manifest)).toThrow(/simulated/);
  });
});

describe("checked-in fixture set (§12.2 scenarios)", () => {
  it("loads every scenario fixture with only SIMULATED labels", async () => {
    const { fixtures, files } = await loadFixtureDirectory(fixturesDir);
    expect(files.sort()).toEqual(
      [
        "classification-change.json",
        "conflicting-sources.json",
        "duplicates.json",
        "malformed-inputs.json",
        "missing-intervals.json",
        "normal-transit.json",
        "out-of-order.json",
        "port-entry-exit.json",
        "sg-missing-intervals.json",
        "sg-normal-transit.json",
        "sg-port-entry-exit.json",
        "sg-stationary-anchorage.json",
        "source-outage.json",
        "stationary-anchorage.json",
        "stale-cache-fallback.json",
      ].sort()
    );
    for (const fixture of fixtures) {
      expect(fixture.truthState).toBe(REQUIRED_FIXTURE_TRUTH_STATE);
      // malformed-inputs intentionally rejects records; every other fixture is clean.
      if (fixture.fixtureId === "malformed-inputs") {
        expect(fixture.rejected.length).toBeGreaterThan(0);
      } else {
        expect(fixture.rejected).toEqual([]);
      }
    }
  });

  it("normal-transit: ordered transit with expected count", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "normal-transit")!;
    expect(fx.observations).toHaveLength(5);
    const times = fx.observations.map((o) => o.observedAt);
    expect(times).toEqual([...times].sort());
  });

  it("stationary-anchorage: speeds below 0.5 knots", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "stationary-anchorage")!;
    for (const o of fx.observations) {
      expect(o.kinematics.speedKnots).toBeLessThan(0.5);
    }
  });

  it("port-entry-exit: contains points inside and outside the scenario bbox", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(path.join(fixturesDir, "port-entry-exit.json"), "utf-8"));
    const parsed = parseFixture(manifest);
    const box = (manifest.scenario as { regionBbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } }).regionBbox;
    const inside = parsed.observations.filter(
      (o) =>
        o.position.latitude >= box.minLat && o.position.latitude <= box.maxLat &&
        o.position.longitude >= box.minLon && o.position.longitude <= box.maxLon
    );
    const outside = parsed.observations.filter((o) => !inside.includes(o));
    expect(inside.length).toBe(3);
    expect(outside.length).toBe(3);
    // Entering the region then leaving it: outside, inside, outside sequence.
    expect(parsed.observations[0]!.position.longitude).toBeLessThan(box.minLon);
    expect(parsed.observations[parsed.observations.length - 1]!.position.longitude).toBeGreaterThan(box.maxLon);
  });

  it("missing-intervals: largest gap matches the declared 10800 seconds", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "missing-intervals")!;
    const sorted = fx.observations.slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    let largest = 0;
    for (let i = 1; i < sorted.length; i++) {
      largest = Math.max(largest, (Date.parse(sorted[i]!.observedAt) - Date.parse(sorted[i - 1]!.observedAt)) / 1000);
    }
    expect(largest).toBe(10800);
  });

  it("duplicates: 8 raw records deduplicate to 4 unique", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "duplicates")!;
    expect(fx.observations).toHaveLength(8);
    const { unique, duplicatesRemoved } = dedupeObservations(fx.observations);
    expect(unique).toHaveLength(4);
    expect(duplicatesRemoved).toBe(4);
  });

  it("classification-change: classification sequence matches the declared policy metadata", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "classification-change")!;
    const sequence = fx.observations
      .slice()
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .map((o) => o.entityType);
    expect(sequence).toEqual(["cargo_vessel", "cargo_vessel", "tanker", "unknown"]);
  });

  it("conflicting-sources: both provider records survive deduplication (§3.3)", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "conflicting-sources")!;
    expect(fx.observations).toHaveLength(2);
    const { unique } = dedupeObservations(fx.observations);
    expect(unique).toHaveLength(2);
    const providers = new Set(unique.map((o) => o.source.providerId));
    expect(providers).toEqual(new Set(["simulated-fixture", "simulated-fixture-b"]));
    // The two records disagree on position and both stay visible.
    const [a, b] = unique as [typeof unique[number], typeof unique[number]];
    expect(a.position).not.toEqual(b.position);
  });

  it("malformed-inputs: rejects exactly the six malformed records with reasons", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "malformed-inputs")!;
    expect(fx.observations).toHaveLength(2);
    expect(fx.rejected).toHaveLength(6);
    const reasons = fx.rejected.map((r) => r.reason).join("\n");
    expect(reasons).toMatch(/invalid latitude/);
    expect(reasons).toMatch(/invalid longitude/);
    expect(reasons).toMatch(/invalid observedAt/);
    expect(reasons).toMatch(/invalid entityType/);
    expect(reasons).toMatch(/headingDegrees/);
    expect(reasons).toMatch(/licenseId/);
    // Every rejected record keeps its id for diagnostics.
    for (const r of fx.rejected) expect(r.observationId).toBeTruthy();
  });

  it("singapore fixtures: observations membership-verified inside singapore-roadstead v1", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const sgIds = ["sg-normal-transit", "sg-stationary-anchorage", "sg-port-entry-exit", "sg-missing-intervals"];
    for (const id of sgIds) {
      const fx = fixtures.find((f) => f.fixtureId === id);
      expect(fx, `fixture ${id} must exist`).toBeTruthy();
      expect(fx!.observations.length).toBeGreaterThan(0);
    }
    // The anchorage fixture is a four-vessel waiting cohort.
    const anchorage = fixtures.find((f) => f.fixtureId === "sg-stationary-anchorage")!;
    const entities = new Set(anchorage.observations.map((o) => o.entityId));
    expect(entities.size).toBe(4);
    const speeds = anchorage.observations.map((o) => o.kinematics.speedKnots ?? 0);
    expect(Math.max(...speeds)).toBeLessThan(0.5);
  });

  it("out-of-order: fixture arrives shuffled and canonical ordering fixes it", async () => {
    const { fixtures } = await loadFixtureDirectory(fixturesDir);
    const fx = fixtures.find((f) => f.fixtureId === "out-of-order")!;
    const times = fx.observations.map((o) => o.observedAt);
    expect(times).not.toEqual([...times].sort());
    const sorted = fx.observations.slice().sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    expect(sorted[0]!.observedAt).toBe("2026-09-09T12:00:00Z");
  });
});
