
/**
 * Network view tests (NETWORK-VIEW-PLAN.md Phase 1): route-arc resolution,
 * mode-aware compare rows, the merged-observation render contract (the
 * showObservations clobber fix), and the network camera frame.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import { centroidOfRing, resolveRouteArcs, primaryFence, ROUTE_LEGS } from "../../src/config/routes";
import { CHOKEPOINT_REGISTRY, getChokepoint } from "../../src/config/chokepoints";
import {
  compareRows,
  networkObservations,
  sortRowsByAnomaly,
  sortRowsByRegion,
} from "../../src/ui/compareTable";
import { frameForPoints } from "../../src/scene/camera";
import { OVERLAY_BUDGETS } from "../../src/scene/renderGovernor";

const WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" };

const manager = await createDataManager({ mode: "fixture" });
const snaps = manager.getAllSnapshots(WINDOW);
const hint = (f: string) => manager.coverageHint(f);

describe("routes config (illustrative corridors)", () => {
  it("computes the vertex-mean centroid of a known ring", () => {
    const ring = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ] as const;
    expect(centroidOfRing(ring)).toEqual([5, 5]);
  });

  it("rejects an empty ring", () => {
    expect(() => centroidOfRing([])).toThrow();
  });

  it("resolves one arc per declared leg with valid endpoints", () => {
    const arcs = resolveRouteArcs();
    expect(arcs.length).toBe(ROUTE_LEGS.length);
    for (const arc of arcs) {
      const [lat, lon] = arc.from;
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(lon)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(arc.label).toMatch(/illustrative corridor/i);
      expect(arc.label).toMatch(/not a tracked vessel path/i);
    }
  });

  it("anchors arcs on the primary fence (same rule as focus framing)", () => {
    for (const arc of resolveRouteArcs()) {
      for (const id of [arc.fromId, arc.toId]) {
        const profile = getChokepoint(id)!;
        const fence = primaryFence(profile);
        expect(fence.geometry.kind).toBe("polygon");
      }
    }
  });

  it("skips legs with unknown profiles or non-polygon geometry (never guesses)", () => {
    const arcs = resolveRouteArcs(CHOKEPOINT_REGISTRY, [["no-such-profile", "long-beach-approach"]]);
    expect(arcs).toEqual([]);
  });
});

describe("compare rows (mode-aware headline, §3.3)", () => {
  it("produces one row per registry profile", () => {
    const rows = compareRows(snaps, hint);
    expect(rows.length).toBe(CHOKEPOINT_REGISTRY.length);
    expect(rows.map((r) => r.chokepointId)).toEqual(CHOKEPOINT_REGISTRY.map((p) => p.id));
  });

  it("land profile headline comes from facility metrics, not empty entity metrics", () => {
    const rows = compareRows(snaps, hint);
    const elPaso = rows.find((r) => r.chokepointId === "el-paso-border-crossings")!;
    expect(elPaso.mode).toBe("land");
    if (elPaso.headline) {
      expect(elPaso.headline.id).toMatch(/^facility-/);
    }
  });

  it("badges come from the §9.3 vocabulary only", () => {
    const allowed = ["LIVE", "DERIVED", "ESTIMATE", "SIM", "STALE", "UNKNOWN"];
    for (const row of compareRows(snaps, hint)) {
      if (row.headline) expect(allowed).toContain(row.headline.badge);
    }
  });

  it("coverage states use the injected §6.1 hint (Suez unknown)", () => {
    const rows = compareRows(snaps, hint);
    const suez = rows.find((r) => r.chokepointId === "suez-canal-approaches")!;
    expect(suez.coverageState).toBe("unknown");
    const lb = rows.find((r) => r.chokepointId === "long-beach-approach")!;
    expect(lb.coverageState).toBe("covered");
  });

  it("sorts are deterministic (anomaly priority desc, id asc; region asc)", () => {
    const rows = compareRows(snaps, hint);
    const a1 = sortRowsByAnomaly(rows).map((r) => r.chokepointId);
    const a2 = sortRowsByAnomaly(compareRows(snaps, hint)).map((r) => r.chokepointId);
    expect(a1).toEqual(a2);
    const r1 = sortRowsByRegion(rows).map((r) => r.region);
    expect([...r1].sort()).toEqual(r1);
  });
});

describe("network observations (merged draw set)", () => {
  it("merges observations from ALL profiles — the clobber regression test", () => {
    const merged = networkObservations(snaps);
    const totalFromProfiles = snaps.reduce((n, s) => n + s.observations.length, 0);
    // Budget allows all fixture observations (5 profiles x tiny fixtures).
    if (totalFromProfiles <= OVERLAY_BUDGETS.vesselPoints) {
      expect(merged.observations.length).toBe(totalFromProfiles);
    }
    // The merge is never EMPTY when profiles have observations.
    expect(merged.observations.length).toBeGreaterThan(0);
    // Every sea profile's observations survive (not just the last one).
    const seaProfiles = ["long-beach-approach", "singapore-malacca-approach", "suez-canal-approaches"];
    const entityIds = new Set(merged.observations.map((o) => o.entityId));
    for (const p of seaProfiles) {
      const snap = snaps.find((s) => s.profile.id === p)!;
      if (snap.observations.length > 0) {
        expect(entityIds.has(snap.observations[0]!.entityId)).toBe(true);
      }
    }
  });

  it("draw order is stable by observedAt (no scene reorder mid-replay)", () => {
    const merged = networkObservations(snaps);
    const times = merged.observations.map((o) => o.observedAt);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });

  it("is bounded per profile by the render-governor budget", () => {
    const merged = networkObservations(snaps);
    const total = Object.values(merged.droppedPerProfile).reduce((a, b) => a + b, 0);
    expect(merged.observations.length + total).toBe(snaps.reduce((n, s) => n + s.observations.length, 0));
  });
});

describe("network camera frame", () => {
  it("frames a global point set top-down with margin", () => {
    const frame = frameForPoints([
      [33.6, -118.1],
      [1.2, 103.8],
      [30, 32.3],
    ]);
    expect(frame.pitchDegrees).toBe(-90);
    expect(frame.heightMeters).toBeLessThanOrEqual(3_000_000);
    expect(frame.longitude).toBeGreaterThan(-118);
    expect(frame.longitude).toBeLessThan(104);
  });

  it("requires at least one point", () => {
    expect(() => frameForPoints([])).toThrow();
  });
});
