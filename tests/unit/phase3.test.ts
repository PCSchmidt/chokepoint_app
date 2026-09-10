/**
 * Phase 3 domain tests (§12.1, §12.5 subset): app state, share-link round
 * trips (no secrets, §11.2), camera framing, bounded render cohorts (§12.5
 * overlay budget), and REPLAY DETERMINISM (Phase 3 exit criterion).
 */

import { describe, expect, it } from "vitest";
import { AppState, initialAppState, DEFAULT_REPLAY_SPEED } from "../../src/app/appState";
import { encodeShareState, decodeShareState, toShareState, shareUrl } from "../../src/app/shareState";
import { frameForRing, heightForSpanKm } from "../../src/scene/camera";
import { getMapStack, MAP_STACKS, DEFAULT_MAP_STACK, OFFLINE_FALLBACK_STACK } from "../../src/scene/mapStack";
import { selectBoundedCohort, cohortsAreStable, OVERLAY_BUDGETS } from "../../src/scene/renderGovernor";
import type { DetectedEvent } from "../../src/analytics/events";
import { TimelineController, replayWindow } from "../../src/ui/timeline";
import { launcherCards } from "../../src/ui/missionLauncher";
import { eventCardViewModel } from "../../src/overlays/eventCards";

const LB_RING = [
  [33.7182, -118.2052],
  [33.7181, -118.1768],
  [33.7181, -118.1331],
  [33.6731, -118.1008],
  [33.6382, -118.1167],
  [33.67, -118.19],
  [33.695, -118.225],
  [33.7072, -118.2387],
] as const;

describe("app state", () => {
  it("defaults to fixture mode with sane overlays", () => {
    const s = initialAppState();
    expect(s.sourceMode).toBe("fixture");
    expect(s.overlays.vessels).toBe(true);
    expect(s.overlays.density).toBe(false);
  });

  it("patches immutably and notifies subscribers", () => {
    const store = new AppState("fixture");
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.chokepointId ?? "none"));
    store.update({ chokepointId: "long-beach-approach" });
    store.update({ sourceMode: "live" });
    expect(seen).toEqual(["long-beach-approach", "long-beach-approach"]);
    expect(store.get().sourceMode).toBe("live");
  });

  it("switching chokepoints resets stale selections (§ fresh investigation)", () => {
    const store = new AppState();
    store.update({ chokepointId: "long-beach-approach", selectedEntityId: "e1", selectedEventId: "ev1" });
    store.update({ chokepointId: "suez-canal-approaches" });
    expect(store.get().selectedEntityId).toBeNull();
    expect(store.get().selectedEventId).toBeNull();
  });

  it("replay patch merges without clobbering speed", () => {
    const store = new AppState();
    store.update({ replay: { playing: true } });
    expect(store.get().replay.playing).toBe(true);
    expect(store.get().replay.speedMultiplier).toBe(DEFAULT_REPLAY_SPEED);
    store.update({ replay: { speedMultiplier: 120 } });
    expect(store.get().replay.playing).toBe(true);
    expect(store.get().replay.speedMultiplier).toBe(120);
  });

  it("unsubscribe stops notifications", () => {
    const store = new AppState();
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls += 1;
    });
    store.update({ sourceMode: "live" });
    unsub();
    store.update({ sourceMode: "fixture" });
    expect(calls).toBe(1);
  });
});

describe("share state (§11.2: no secrets, no private data)", () => {
  const snapshot = {
    chokepointId: "long-beach-approach",
    timeWindow: { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" },
    replay: { cursor: "2026-09-09T13:30:00Z" },
    selectedEventId: "queue_buildup@long-beach-approach@2026-09-09T12:00:00Z",
    selectedEntityId: null,
    sourceMode: "fixture" as const,
    overlays: { vessels: true, eventCards: true, density: false },
  };

  it("round-trips encode -> decode", () => {
    const decoded = decodeShareState(encodeShareState(toShareState(snapshot)));
    expect(decoded).not.toBeNull();
    expect(decoded!.chokepointId).toBe(snapshot.chokepointId);
    expect(decoded!.timeWindow).toEqual(snapshot.timeWindow);
    expect(decoded!.replayCursor).toBe("2026-09-09T13:30:00Z");
    expect(decoded!.selectedEventId).toBe(snapshot.selectedEventId);
    expect(decoded!.sourceMode).toBe("fixture");
    expect(decoded!.overlays).toEqual(snapshot.overlays);
  });

  it("builds a copy-pasteable URL with the hash", () => {
    const url = shareUrl("https://example.com/app", snapshot);
    expect(url).toMatch(/^https:\/\/example\.com\/app#/);
    const decoded = decodeShareState(new URL(url).hash);
    expect(decoded!.chokepointId).toBe("long-beach-approach");
  });

  it("missing overlay flags decode to sane defaults (never a blank map)", () => {
    const decoded = decodeShareState("#c=long-beach-approach&m=fixture");
    expect(decoded!.overlays.vessels).toBe(true);
    expect(decoded!.overlays.eventCards).toBe(true);

  });

  it("rejects malformed input: bad timestamps, half windows, garbage", () => {
    expect(decodeShareState("#t0=not-a-time&t1=2026-09-09T12:00:00Z")).toBeNull();
    expect(decodeShareState("#t0=2026-09-09T12:00:00Z")).toBeNull(); // window without end
    expect(decodeShareState("#")).toBeNull();
    expect(decodeShareState("")).toBeNull();
  });

  it("encodes no secrets by construction (no field exists for them)", () => {
    const encoded = encodeShareState(toShareState({ ...snapshot, sourceMode: "live" }));
    expect(encoded).not.toMatch(/key|token|secret/i);
  });
});

describe("camera framing (§4.1)", () => {
  it("frames the LB anchorage with a centroid destination and oblique pitch", () => {
    const frame = frameForRing(LB_RING);
    expect(frame.latitude).toBeCloseTo((33.7182 + 33.6382) / 2, 5);
    expect(frame.longitude).toBeCloseTo((-118.2387 + -118.1008) / 2, 5);
    // Top-down: the destination IS the frame center (an oblique pitch lands
    // the visible center height*tan(|pitch|) away — caught by QA picking).
    expect(frame.pitchDegrees).toBe(-90);
    // Span: ~0.08 deg lat = ~8.9 km; height with 1.6 padding in a sane range.
    expect(frame.heightMeters).toBeGreaterThan(8_000);
    expect(frame.heightMeters).toBeLessThan(60_000);
  });

  it("larger fences fly higher; height helper clamps", () => {
    const small = heightForSpanKm(5);
    const big = heightForSpanKm(500);
    expect(big).toBeGreaterThan(small);
    expect(heightForSpanKm(0)).toBe(8_000); // min clamp
    expect(heightForSpanKm(10_000)).toBe(3_000_000); // max clamp
  });

  it("is deterministic and symmetric under vertex order reversal", () => {
    expect(frameForRing(LB_RING)).toEqual(frameForRing([...LB_RING].reverse()));
  });
});

describe("render governor (§12.5 bounded, deterministic overlays)", () => {
  const candidates = Array.from({ length: 1000 }, (_, i) => ({
    id: `v-${String(i).padStart(4, "0")}`,
    priority: (i % 7) * 0.1,
  }));

  it("never exceeds the budget and reports the dropped count", () => {
    const selection = selectBoundedCohort(candidates, OVERLAY_BUDGETS.vesselLabels);
    expect(selection.selected.length).toBe(OVERLAY_BUDGETS.vesselLabels);
    expect(selection.dropped).toBe(1000 - 40);
    expect(selection.considered).toBe(1000);
  });

  it("is deterministic: identical input yields an identical cohort (no flicker)", () => {
    const a = selectBoundedCohort(candidates, 40);
    const b = selectBoundedCohort([...candidates].reverse(), 40);
    expect(a.selected.map((c) => c.id)).toEqual(b.selected.map((c) => c.id));
    // Stability across repeated frames:
    expect(a.selected).toEqual(a.selected);
    expect(cohortsAreStable(a.selected, b.selected)).toBe(true);
  });

  it("respects maxCount 0 and throws on invalid budgets", () => {
    expect(selectBoundedCohort(candidates, 0).selected).toEqual([]);
    expect(() => selectBoundedCohort(candidates, -1)).toThrow();
    expect(() => selectBoundedCohort(candidates, 1.5)).toThrow();
  });
});

describe("timeline and replay determinism (§12.5 Phase 3 exit)", () => {
  const WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" };

  it("advancing the same steps yields identical cursors (deterministic replay)", () => {
    const a = new TimelineController(WINDOW, 60);
    const b = new TimelineController(WINDOW, 60);
    a.play();
    b.play();
    for (let i = 0; i < 20; i++) {
      a.advance(500);
      b.advance(500);
    }
    expect(a.get()).toEqual(b.get());
  });

  it("pauses at the window end (no wraparound)", () => {
    const t = new TimelineController(WINDOW, 60);
    t.play();
    t.seek("2026-09-09T13:59:30Z");
    t.advance(60_000); // would overshoot; must clamp and pause
    expect(t.get().cursor).toBe("2026-09-09T14:00:00Z");
    expect(t.get().playing).toBe(false);
  });

  it("replayWindow is a deterministic look-back ending at the cursor", () => {
    const w = replayWindow("2026-09-09T13:30:00Z", 1800);
    expect(w).toEqual({ startAt: "2026-09-09T13:00:00Z", endAt: "2026-09-09T13:30:00Z" });
    expect(replayWindow("2026-09-09T13:30:00Z", 1800)).toEqual(w);
    // App default look-back covers a full fixture timeline (6h).
    expect(replayWindow("2026-09-09T15:20:00Z")).toEqual({
      startAt: "2026-09-09T09:20:00Z",
      endAt: "2026-09-09T15:20:00Z",
    });
  });

  it("seek clamps into the window and rejects garbage", () => {
    const t = new TimelineController(WINDOW, 60);
    t.seek("2020-01-01T00:00:00Z");
    expect(t.get().cursor).toBe("2026-09-09T12:00:00Z");
    expect(() => t.seek("whenever")).toThrow();
  });
});

describe("mission launcher view model (§4.3 config-driven, §6.1 coverage honesty)", () => {
  const profiles = [
    {
      id: "long-beach-approach",
      name: "Los Angeles / Long Beach",
      region: "North America",
      geofences: [{ id: "outer-anchorage" }, { id: "approach-corridor" }],
      limitations: ["a", "b"],
    },
    {
      id: "suez-canal-approaches",
      name: "Suez Canal Approaches",
      region: "MENA",
      geofences: [{ id: "gulf-of-suez-approach" }, { id: "port-said-approach" }],
      limitations: ["x"],
    },
  ];

  it("reports covered/partial/unknown from the §6.1 hints", () => {
    const cards = launcherCards(profiles, (fenceId) =>
      fenceId.startsWith("gulf") || fenceId.startsWith("port-said") ? "unknown" : "covered"
    );
    expect(cards[0]!.coverageState).toBe("covered");
    expect(cards[1]!.coverageState).toBe("unknown");
  });

  it("mixed coverage is partial", () => {
    const cards = launcherCards([profiles[0]!], (fenceId) =>
      fenceId === "outer-anchorage" ? "covered" : "unknown"
    );
    expect(cards[0]!.coverageState).toBe("partial");
  });
});

describe("event card view model (bounded, §4.1)", () => {
  const events: DetectedEvent[] = Array.from({ length: 10 }, (_, i) => ({
    eventId: `queue_buildup@s@${i}`,
    eventType: "queue_buildup" as const,
    scope: "s",
    detectedAt: "2026-09-09T14:00:00Z",
    currentWindow: { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T14:00:00Z" },
    baselineWindow: { startAt: "2026-09-09T10:00:00Z", endAt: "2026-09-09T12:00:00Z" },
    metricId: "m",
    baselineMetricId: "b",
    currentValue: 20 + i,
    baselineValue: 10,
    absoluteChange: 10 + i,
    relativeChange: 1 + i * 0.1,
    quality: { state: "fresh" as const, coverageNote: "fired" },
    formulaVersion: "event-detector-v1",
  }));

  it("bounds the cohort deterministically and reports dropped count", () => {
    const vm = eventCardViewModel(events);
    expect(vm.cards.length).toBeLessThanOrEqual(6);
    expect(vm.dropped).toBeGreaterThan(0);
    const again = eventCardViewModel(events);
    expect(again.cards.map((c) => c.eventId)).toEqual(vm.cards.map((c) => c.eventId));
  });
});


describe("keyless map stack (§4.1, §6.2)", () => {
  it("default is keyless Esri satellite (user decision 2026-09-09); offline fallback exists", () => {
    expect(DEFAULT_MAP_STACK).toBe("esri-world-imagery");
    expect(OFFLINE_FALLBACK_STACK).toBe("natural-earth-ii");
    const fallback = getMapStack(OFFLINE_FALLBACK_STACK)!;
    expect(fallback.offline).toBe(true);
    // Every stack stays keyless (§6.2).
    for (const stack of MAP_STACKS) {
      expect(stack.keyless).toBe(true);
      expect(stack.attributionText.length).toBeGreaterThan(0);
    }
  });

  it("external stacks carry their terms note (§15)", () => {
    expect(getMapStack("esri-world-imagery")!.externalTermsNote).toBeTruthy();
    expect(getMapStack("osm-standard")!.externalTermsNote).toMatch(/ODbL/);
    expect(getMapStack("natural-earth-ii")!.offline).toBe(true);
  });
});
