/**
 * Source health state machine tests (§3.1, §12.1): fresh/stale/degraded/
 * unavailable/never_answered transitions, time drift, and orthogonality rules.
 */

import { describe, expect, it } from "vitest";
import {
  SourceHealthStateMachine,
  type RefreshOutcome,
} from "../../src/data/sourceHealth";

const T0 = "2026-09-09T12:00:00Z";
const plus = (base: string, seconds: number) =>
  new Date(Date.parse(base) + seconds * 1000).toISOString().replace(".000Z", "Z");

const machine = () =>
  new SourceHealthStateMachine("test-source", { freshWithinSeconds: 1800 });

describe("initial state", () => {
  it("starts at NEVER_ANSWERED before any refresh", () => {
    const m = machine();
    expect(m.currentState).toBe("NEVER_ANSWERED");
    expect(m.snapshot(T0).state).toBe("NEVER_ANSWERED");
    expect(m.snapshot(T0).lastRefreshAt).toBeNull();
    expect(m.snapshot(T0).lastObservationAt).toBeNull();
  });
});

describe("success transitions", () => {
  it("recent successful refresh is FRESH", () => {
    const m = machine();
    const state = m.recordRefresh({ status: "ok", now: T0, lastObservationAt: plus(T0, -60) });
    expect(state).toBe("FRESH");
    expect(m.snapshot(T0).ageSeconds).toBe(60);
  });

  it("successful refresh with old data is STALE (never silently fresh)", () => {
    const m = machine();
    const state = m.recordRefresh({ status: "ok", now: plus(T0, 7200), lastObservationAt: T0 });
    expect(state).toBe("STALE");
    expect(m.snapshot(plus(T0, 7200)).detail).toMatch(/freshness threshold/);
  });

  it("successful refresh with zero observations is UNAVAILABLE (empty but honest, §6.2)", () => {
    const m = machine();
    const state = m.recordRefresh({ status: "ok", now: T0 });
    expect(state).toBe("UNAVAILABLE");
    expect(m.snapshot(T0).detail).toMatch(/no observations/);
  });

  it("lastObservationAt never moves backwards", () => {
    const m = machine();
    m.recordRefresh({ status: "ok", now: T0, lastObservationAt: plus(T0, -60) });
    m.recordRefresh({ status: "ok", now: plus(T0, 30), lastObservationAt: plus(T0, -600) });
    expect(m.snapshot(plus(T0, 30)).lastObservationAt).toBe(plus(T0, -60));
  });
});

describe("degraded and failure transitions", () => {
  it("partial success is DEGRADED even with fresh data (§3.1: derived + degraded stays degraded)", () => {
    const m = machine();
    const state = m.recordRefresh({
      status: "partial",
      now: T0,
      lastObservationAt: plus(T0, -10),
      rejectedCount: 3,
      reason: "malformed payload fields",
    });
    expect(state).toBe("DEGRADED");
    expect(m.snapshot(T0).detail).toMatch(/3 record/);
  });

  it("failure is UNAVAILABLE and retains the last known observation", () => {
    const m = machine();
    m.recordRefresh({ status: "ok", now: T0, lastObservationAt: plus(T0, -60) });
    const state = m.recordRefresh({ status: "failure", now: plus(T0, 120), reason: "provider timeout" });
    expect(state).toBe("UNAVAILABLE");
    const snap = m.snapshot(plus(T0, 120));
    expect(snap.lastObservationAt).toBe(plus(T0, -60));
    expect(snap.detail).toBe("provider timeout");
  });

  it("recovers to FRESH after UNAVAILABLE on a good refresh", () => {
    const m = machine();
    m.recordRefresh({ status: "failure", now: T0, reason: "provider timeout" });
    expect(m.currentState).toBe("UNAVAILABLE");
    const state = m.recordRefresh({ status: "ok", now: plus(T0, 300), lastObservationAt: plus(T0, 290) });
    expect(state).toBe("FRESH");
  });
});

describe("time drift (assess)", () => {
  it("FRESH decays to STALE when the newest observation ages past the threshold", () => {
    const m = machine();
    m.recordRefresh({ status: "ok", now: T0, lastObservationAt: T0 });
    expect(m.assess(plus(T0, 1799))).toBe("FRESH");
    expect(m.assess(plus(T0, 1801))).toBe("STALE");
  });

  it("DEGRADED is never silently upgraded or downgraded by time alone (§3.1)", () => {
    const m = machine();
    m.recordRefresh({
      status: "partial",
      now: T0,
      lastObservationAt: T0,
      rejectedCount: 1,
      reason: "degraded feed",
    });
    expect(m.assess(plus(T0, 100000))).toBe("DEGRADED");
  });

  it("NEVER_ANSWERED and UNAVAILABLE do not drift on their own", () => {
    const m = machine();
    expect(m.assess(plus(T0, 999999))).toBe("NEVER_ANSWERED");
    m.recordRefresh({ status: "failure", now: T0, reason: "down" });
    expect(m.assess(plus(T0, 999999))).toBe("UNAVAILABLE");
  });
});

describe("determinism and validation", () => {
  it("is deterministic for identical event sequences", () => {
    const replay = (outcomes: RefreshOutcome[]) => {
      const m = machine();
      for (const o of outcomes) m.recordRefresh(o);
      return m.snapshot(plus(T0, 200));
    };
    const outcomes: RefreshOutcome[] = [
      { status: "ok", now: T0, lastObservationAt: plus(T0, -30) },
      { status: "partial", now: plus(T0, 60), lastObservationAt: plus(T0, 30), rejectedCount: 2, reason: "x" },
      { status: "failure", now: plus(T0, 120), reason: "y" },
      { status: "ok", now: plus(T0, 180), lastObservationAt: plus(T0, 170) },
    ];
    expect(replay(outcomes)).toEqual(replay(outcomes));
    expect(replay(outcomes).state).toBe("FRESH");
  });

  it("rejects out-of-order refresh events", () => {
    const m = machine();
    m.recordRefresh({ status: "ok", now: plus(T0, 100) });
    expect(() =>
      m.recordRefresh({ status: "ok", now: T0, lastObservationAt: plus(T0, 90) })
    ).toThrow(/chronological/);
  });

  it("rejects malformed timestamps", () => {
    const m = machine();
    expect(() => m.recordRefresh({ status: "ok", now: "whenever" })).toThrow(/invalid now/);
    expect(() => machine().recordRefresh({ status: "ok", now: T0, lastObservationAt: "nope" })).toThrow(/lastObservationAt/);
  });

  it("requires a positive freshness threshold", () => {
    expect(() => new SourceHealthStateMachine("s", { freshWithinSeconds: 0 })).toThrow();
  });
});
