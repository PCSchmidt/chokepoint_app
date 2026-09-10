/**
 * Data-layer manager tests (§9.2 src/data/manager.ts): fixture-mode snapshots
 * assemble profile + observations + §7 metrics + events + provenance from the
 * SIMULATED fixtures with the reviewed geometry, with honest live fallback.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";

describe("fixture-mode manager (SIMULATED data only)", () => {
  it("boots keyless and lists the maritime MVP profiles plus the multimodal candidates", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    expect(manager.mode).toBe("fixture");
    expect(manager.liveAvailable).toBe(false); // no key, honest (§6.2)
    expect(manager.listChokepoints().map((c) => c.id)).toEqual([
      "long-beach-approach",
      "singapore-malacca-approach",
      "suez-canal-approaches",
      "lax-cargo-air",
      "el-paso-border-crossings",
    ]);
    manager.destroy();
  });

  it("defaultWindow derives from the fixture timeline (deterministic)", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    // Max observedAt across fixtures: missing-intervals ends at 15:20Z.
    expect(manager.defaultWindow()).toEqual({
      startAt: "2026-09-09T12:00:00Z",
      endAt: "2026-09-09T15:20:00Z",
    });
    manager.destroy();
  });

  it("LB snapshot: metrics computed with provenance and health from the fixture adapter", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    const snapshot = manager.getSnapshot("long-beach-approach", manager.defaultWindow());
    expect(snapshot.profile.id).toBe("long-beach-approach");
    expect(snapshot.sourceMode).toBe("fixture");
    // Fixture vessels sit near the anchorage fence; at least the counts are
    // deterministic and carry full quality metadata.
    for (const metric of Object.values(snapshot.metrics)) {
      expect(metric.metricType).toBeTruthy();
      expect(metric.formulaVersion).toBeTruthy();
      expect(metric.quality.coverageNote).toBeTruthy();
      expect(metric.observationWindow.startAt).toBe(snapshot.window.startAt);
    }
    expect(snapshot.metrics.vesselCount.value).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(snapshot.events)).toBe(true);
    expect(snapshot.provenance.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.provenance[0]!.truthState).toBe("SIMULATED");
    expect(snapshot.attribution.truthState).toBe("SIMULATED");
    expect(snapshot.health.fixture!.state).toBeTruthy();
    expect(snapshot.health.live).toBeNull(); // no key -> honest null, not fake data
    manager.destroy();
  });

  it("deterministic: two snapshots of the same window are identical", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    const a = manager.getSnapshot("long-beach-approach", manager.defaultWindow());
    const b = manager.getSnapshot("long-beach-approach", manager.defaultWindow());
    expect(a.metrics).toEqual(b.metrics);
    expect(a.observations).toEqual(b.observations);
    expect(a.events).toEqual(b.events);
    manager.destroy();
  });

  it("coverage hints reflect the §6.1 smoke evidence (Suez unknown)", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    expect(manager.coverageHint("outer-anchorage")).toBe("covered");
    expect(manager.coverageHint("strait-traffic-corridor")).toBe("covered");
    expect(manager.coverageHint("gulf-of-suez-approach")).toBe("unknown");
    expect(manager.coverageHint("port-said-approach")).toBe("unknown");
    manager.destroy();
  });

  it("throws for an unknown chokepoint", async () => {
    const manager = await createDataManager({ mode: "fixture" });
    expect(() => manager.getSnapshot("not-a-chokepoint", manager.defaultWindow())).toThrow();
    manager.destroy();
  });
});

describe("live-mode fallback (no key in tests)", () => {
  it("live adapter is null without a key; mode stays fixture-adjacent and honest", async () => {
    const manager = await createDataManager({ mode: "live" }); // no apiKey
    expect(manager.liveAvailable).toBe(false);
    manager.destroy();
  });
});
