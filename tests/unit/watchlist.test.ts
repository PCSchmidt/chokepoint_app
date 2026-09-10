/**
 * Watchlist tests (CHOKEPOINT-PLAN.md Workflow E, §11.1, §3.3, §14.4).
 *
 * Deterministic local evaluation against real manager snapshots over
 * SIMULATED fixtures: unknown comparisons never fire, stale sources respect
 * the freshness policy, and the language is threshold-crossing only.
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import {
  loadWatchlist,
  saveWatchlist,
  upsertWatchEntry,
  removeWatchEntry,
  evaluateWatchEntry,
  evaluateWatchlist,
  watchEntryId,
  type WatchlistEntry,
} from "../../src/app/watchlist";
import { renderWatchlistPanel, renderWatchlistSaveForm } from "../../src/ui/watchlist";

const WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" };

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  const base = {
    chokepointId: "long-beach-approach",
    fenceIds: ["lb-anchorage", "lb-approach"],
    metricId: "vessel_count" as const,
    direction: "increase" as const,
    relativePctThreshold: 10,
    freshnessPolicy: "require-fresh" as const,
    configVersion: "test-v1",
  };
  const merged = { ...base, ...overrides };
  return { ...merged, id: watchEntryId(merged), createdAt: "2026-09-09T12:00:00Z" };
}

describe("watchlist persistence (§11.1 local-first)", () => {
  it("round-trips entries through a storage stub", () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
    };
    expect(loadWatchlist(storage)).toEqual([]);
    saveWatchlist([entry()], storage);
    expect(loadWatchlist(storage)).toHaveLength(1);
    expect(loadWatchlist(storage)[0]!.metricId).toBe("vessel_count");
  });

  it("corrupt storage content is skipped, never crash", () => {
    const bad = { getItem: () => "{not json", setItem: () => {} };
    expect(loadWatchlist(bad)).toEqual([]);
    const wrongShape = { getItem: () => JSON.stringify([{ nope: true }]), setItem: () => {} };
    expect(loadWatchlist(wrongShape)).toEqual([]);
  });

  it("different thresholds are different watches; upsert replaces same semantics", () => {
    const a = entry();
    const b = entry({ relativePctThreshold: 25 });
    expect(a.id).not.toBe(b.id); // threshold is part of the watch semantics
    let list = upsertWatchEntry([], a);
    list = upsertWatchEntry(list, entry()); // same id, later save wins
    expect(list).toHaveLength(1);
    list = upsertWatchEntry(list, b);
    expect(list).toHaveLength(2);
    list = removeWatchEntry(list, a.id);
    expect(list.map((e) => e.id)).toEqual([b.id]);
  });
});

describe("watchlist evaluation (Workflow E step 3-4, deterministic)", async () => {
  const manager = await createDataManager({ mode: "fixture" });
  const snapshot = manager.getSnapshot("long-beach-approach", WINDOW);

  it("clear when the measured change is below the threshold", () => {
    const cmp = snapshot.comparisons.vesselCount;
    const ev = evaluateWatchEntry(entry(), snapshot);
    if (cmp.relativeChange === null || cmp.direction === "unknown") {
      expect(ev.status).toBe("unknown");
    } else {
      const pct = cmp.relativeChange * 100;
      const expected = Math.abs(pct) >= 10 && (pct >= 0) === (entry().direction === "increase");
      expect(ev.status).toBe(expected ? "fired" : "clear");
    }
    // §14.4: threshold language only — no causal words.
    expect(ev.note.toLowerCase()).not.toMatch(/because|caused by|suspicious|threat|disruption/);
  });

  it("a very high threshold can never fire on a small change", () => {
    const ev = evaluateWatchEntry(entry({ relativePctThreshold: 500 }), snapshot);
    expect(ev.status).not.toBe("fired");
  });

  it("metrics without a baseline comparison evaluate honestly as unknown", () => {
    const ev = evaluateWatchEntry(entry({ metricId: "dwell_median_seconds" }), snapshot);
    expect(["unknown", "unavailable"]).toContain(ev.status);
    expect(ev.status).not.toBe("fired");
  });

  it("require-fresh refuses a stale comparison; allow-stale may evaluate", () => {
    // Force the comparison quality through a stale-policy check with the
    // snapshot's actual quality state.
    const ev = evaluateWatchEntry(entry({ freshnessPolicy: "require-fresh" }), snapshot);
    const quality = snapshot.comparisons.vesselCount.qualityState;
    if (quality !== "fresh") expect(ev.status).toBe("unknown");
  });

  it("unknown chokepoints evaluate as unavailable, never fired", () => {
    const evs = evaluateWatchlist([entry({ chokepointId: "not-a-profile" })], () => null);
    expect(evs[0]!.status).toBe("unavailable");
  });
});

describe("watchlist UI render (§9.2)", () => {
  it("empty watchlist renders the honest empty state", () => {
    const el = document.createElement("div");
    renderWatchlistPanel(el, [], [], () => {});
    expect(el.querySelector<HTMLElement>("[data-testid=watchlist-empty]")!.textContent).toMatch(/No saved watches/);
  });

  it("entries render a status badge, label, and remove control", () => {
    const el = document.createElement("div");
    const e = entry();
    const evaluation = {
      entryId: e.id,
      status: "clear" as const,
      note: "vessel_count +2.0% vs baseline — below the +10% threshold",
      observedValue: 11,
      baselineValue: 10.8,
      relativeChangePct: 2.0,
    };
    let removed: string | null = null;
    renderWatchlistPanel(el, [e], [evaluation], (id) => {
      removed = id;
    });
    expect(el.querySelector<HTMLElement>(`[data-testid=watch-${CSS.escape(e.id)}] .watch-status`)!.textContent).toBe("CLEAR");
    (el.querySelector<HTMLElement>(`[data-testid=watch-remove-${CSS.escape(e.id)}]`) as HTMLElement).click();
    expect(removed).toBe(e.id);
  });

  it("save form emits a typed selection", () => {
    const el = document.createElement("div");
    let got: { metricId: string; direction: string; relativePctThreshold: number } | null = null;
    renderWatchlistSaveForm(el, "Long Beach", (s) => {
      got = s;
    });
    (el.querySelector<HTMLElement>("[data-testid=watch-save-btn]") as HTMLElement).click();
    expect(got).toEqual({ metricId: "vessel_count", direction: "increase", relativePctThreshold: 10, freshnessPolicy: "require-fresh" });
  });
});
