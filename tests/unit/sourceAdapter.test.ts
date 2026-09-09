/**
 * Source adapter contract tests (§5.1): lifecycle behavior of the fixture-mode
 * adapter, provenance records (§3.2), scope queries, and outage/cache scenarios.
 * All data is SIMULATED; no live provider is involved.
 */

import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
import type { FixtureManifest } from "../../src/data/fixtureLoader";
import { FixtureSourceAdapter, DEFAULT_FIXTURE_FRESH_WITHIN_SECONDS } from "../../src/data/fixtureAdapter";
import { provenanceForObservations } from "../../src/data/provenance";
import { normalizeObservation } from "../../src/data/observation";
import type { TransportObservation } from "../../src/data/observation";

const fixturesDir = path.resolve("tests/fixtures");
/** Adapters consume raw manifests (re-parsing on every refresh), not parsed fixtures. */
const load = async (name: string): Promise<FixtureManifest> =>
  JSON.parse(await readFile(path.join(fixturesDir, name), "utf-8")) as FixtureManifest;

const CONTEXT = { now: "2026-09-09T12:00:00Z", trigger: "startup" as const };

describe("adapter lifecycle (§5.1)", () => {
  it("enable loads records and reports FRESH health on the fixture timeline", async () => {
    const manifest = await load("normal-transit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    const result = await adapter.enable(CONTEXT);
    expect(result.status).toBe("ok");
    expect(result.acceptedCount).toBe(5);
    expect(result.rejectedCount).toBe(0);
    const status = adapter.getStatus();
    expect(status.state).toBe("FRESH");
    expect(status.lastObservationAt).toBe("2026-09-09T12:20:00Z");
  });

  it("refresh re-ingests deterministically; status matches after refresh", async () => {
    const manifest = await load("normal-transit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    const r1 = await adapter.refresh({ now: CONTEXT.now, trigger: "scheduled" });
    const r2 = await adapter.refresh({ now: CONTEXT.now, trigger: "manual" });
    expect(r1).toEqual(r2);
    expect(r1.acceptedCount).toBe(5);
  });

  it("disable makes the adapter honestly UNAVAILABLE with no records", async () => {
    const manifest = await load("normal-transit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    await adapter.disable();
    expect(adapter.getRecords()).toEqual([]);
    expect(adapter.getStatus().state).toBe("UNAVAILABLE");
    expect(adapter.getStatus().detail).toBe("adapter disabled");
    const refresh = await adapter.refresh({ now: CONTEXT.now, trigger: "manual" });
    expect(refresh.status).toBe("failure");
  });

  it("destroy clears all state and rejects re-enable", async () => {
    const manifest = await load("normal-transit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    adapter.destroy();
    expect(adapter.getRecords()).toEqual([]);
    expect(adapter.getStatus().detail).toBe("adapter destroyed");
    await expect(adapter.enable(CONTEXT)).rejects.toThrow(/destroyed/);
  });

  it("rejects an adapter with no manifests", () => {
    expect(() => new FixtureSourceAdapter({ manifests: [] })).toThrow();
  });
});

describe("scope queries", () => {
  it("filters by time window, mode, and entity type", async () => {
    const manifest = await load("port-entry-exit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    const window = adapter.getRecords({
      timeWindow: { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T12:24:00Z" },
    });
    expect(window).toHaveLength(3);
    expect(adapter.getRecords({ modes: ["air"] })).toEqual([]);
    expect(adapter.getRecords({ entityTypes: ["tanker"] })).toEqual([]);
    expect(adapter.getRecords({ entityTypes: ["bulk_carrier"] })).toHaveLength(6);
  });
});

describe("health scenarios on the fixture timeline", () => {
  it("stale-cache-fallback: STALE when served, with original observation times retained (§3.3)", async () => {
    const manifest = await load("stale-cache-fallback.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    // served at 13:42Z; newest observation is 12:20Z -> age 4920s > 1800s.
    // Original observedAt values are retained; the age gap IS the cache age.
    const status = adapter.getStatus();
    expect(status.state).toBe("STALE");
    expect(status.lastObservationAt).toBe("2026-09-09T12:20:00Z");
    expect(status.ageSeconds).toBe(4920);
  });

  it("source-outage: FRESH at last observation, STALE after the outage window via time drift", async () => {
    const manifest = await load("source-outage.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    expect(adapter.getStatus().state).toBe("FRESH");
    // outage end declared at 14:00Z: no new data, age exceeds threshold
    const atOutageEnd = adapter.getStatusAt("2026-09-09T14:00:00Z");
    expect(atOutageEnd.state).toBe("STALE");
    expect(atOutageEnd.detail).toMatch(/no new observations/);
  });

  it("malformed fixture records produce a partial refresh and DEGRADED health, not silence", async () => {
    const manifest = await load("malformed-inputs.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    const result = await adapter.enable(CONTEXT);
    expect(result.status).toBe("partial");
    expect(result.acceptedCount).toBe(2);
    expect(result.rejectedCount).toBe(6);
    expect(adapter.getStatus().state).toBe("DEGRADED");
  });
});

describe("attribution and provenance (§3.2)", () => {
  it("attribution is explicitly SIMULATED", async () => {
    const manifest = await load("normal-transit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    const attribution = adapter.getAttribution();
    expect(attribution.truthState).toBe("SIMULATED");
    expect(attribution.attributionText).toMatch(/SIMULATED/);
  });

  it("provenance records carry every §3.2 field for a single-provider set", async () => {
    const manifest = await load("normal-transit.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    const provenance = adapter.getProvenance();
    expect(provenance.providerId).toBe("simulated-fixture");
    expect(provenance.endpointId).toBe("fixture://normal-transit");
    expect(provenance.observationInterval).toEqual({
      startAt: "2026-09-09T12:00:00Z",
      endAt: "2026-09-09T12:20:00Z",
    });
    expect(provenance.retrievedAt).toBe("2026-09-09T12:21:00Z");
    expect(provenance.transformationVersion).toBeTruthy();
    expect(provenance.freshnessThresholdSeconds).toBe(DEFAULT_FIXTURE_FRESH_WITHIN_SECONDS);
    expect(provenance.licenseId).toBe("CC0-1.0-synthetic");
    expect(provenance.truthState).toBe("SIMULATED");
    expect(provenance.observationIds).toHaveLength(5);
    expect(provenance.coverageNote).toMatch(/SIMULATED/);
  });

  it("multi-provider fixture sets yield one provenance record per provider (§3.3)", async () => {
    const manifest = await load("conflicting-sources.json");
    const adapter = new FixtureSourceAdapter({ manifests: [manifest] });
    await adapter.enable(CONTEXT);
    expect(adapter.getProvenancePerProvider()).toHaveLength(2);
    expect(() => adapter.getProvenance()).toThrow(/multiple providers/);
  });
});

describe("provenanceForObservations guards", () => {
  const rec = (id: string, provider: string) => {
    const result = normalizeObservation({
      observationId: id,
      entityId: `${provider}:e1`,
      mode: "sea",
      entityType: "cargo_vessel",
      position: { latitude: 33.6, longitude: -118.2 },
      kinematics: { speedKnots: 10 },
      observedAt: "2026-09-09T12:00:00Z",
      receivedAt: "2026-09-09T12:01:00Z",
      source: { providerId: provider, endpointId: "ep", recordRef: id, licenseId: "L" },
      quality: { sourceState: "fresh", classification: "confirmed" },
    });
    if (!result.ok) throw new Error("test record must normalize");
    return result.observation;
  };

  it("rejects empty observation sets", () => {
    expect(() => provenanceForObservations([], "SIMULATED", "v1")).toThrow(/zero observations/);
  });

  it("rejects mixed providers (conflicts stay visible, never merged away)", () => {
    const observations: TransportObservation[] = [rec("1", "simulated-fixture"), rec("2", "simulated-fixture-b")];
    expect(() => provenanceForObservations(observations, "SIMULATED", "v1")).toThrow(/mixed providers/);
  });

  it("accepts a single-provider set and reports the full observation interval", () => {
    const record = provenanceForObservations([rec("1", "p"), rec("2", "p")], "SIMULATED", "v1");
    expect(record.observationInterval.startAt).toBe("2026-09-09T12:00:00Z");
    expect(record.observationIds).toEqual(["1", "2"]);
  });
});
