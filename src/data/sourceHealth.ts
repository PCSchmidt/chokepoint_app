/**
 * Source health state machine (CHOKEPOINT-PLAN.md §3.1, §12.1).
 *
 * Health states are ORTHOGONAL to truth states: a source can be DERIVED +
 * DEGRADED and must never be silently converted to UNKNOWN or presented as
 * fresh. This machine tracks exactly one source's health and provides a
 * deterministic, testable transition model:
 *
 *   Event                 -> Resulting state
 *   ------------------------------------------------
 *   success, recent data  -> FRESH
 *   success, old data     -> STALE
 *   success, no data      -> UNAVAILABLE (empty-but-honest, §6.2)
 *   partial success       -> DEGRADED
 *   failure               -> UNAVAILABLE (last known data retained)
 *   (no event)            -> NEVER_ANSWERED initially
 *
 * Time drift: a FRESH source decays to STALE when its newest observation ages
 * past the freshness threshold, even with no new events (assess()).
 *
 * All timestamps are ISO 8601 strings. Callers pass `now` explicitly so the
 * machine is fully deterministic and testable — it never reads the wall clock.
 */

import type { HealthState } from "./truthState";

export interface SourceHealthConfig {
  /** Observations older than this many seconds (relative to `now`) are not FRESH. */
  freshWithinSeconds: number;
}

export type RefreshOutcome =
  | { status: "ok"; now: string; lastObservationAt?: string | undefined }
  | { status: "partial"; now: string; lastObservationAt?: string | undefined; rejectedCount: number; reason: string }
  | { status: "failure"; now: string; reason: string };

export interface SourceHealthSnapshot {
  state: HealthState;
  /** Time of the last refresh attempt (any outcome), or null if never. */
  lastRefreshAt: string | null;
  /** Time of the newest accepted observation, or null if none was ever seen. */
  lastObservationAt: string | null;
  /** Age of the newest observation relative to the assessment time. */
  ageSeconds: number | null;
  /** Human-readable reason for the current state, when one exists. */
  detail: string | null;
}

function parseIso(iso: string, what: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`SourceHealthStateMachine: invalid ${what} timestamp: ${iso}`);
  return t;
}

export class SourceHealthStateMachine {
  readonly sourceId: string;
  private readonly config: SourceHealthConfig;
  private state: HealthState = "NEVER_ANSWERED";
  private lastRefreshAt: string | null = null;
  private lastObservationAt: string | null = null;
  private detail: string | null = null;

  constructor(sourceId: string, config: SourceHealthConfig) {
    if (!Number.isFinite(config.freshWithinSeconds) || config.freshWithinSeconds <= 0) {
      throw new Error("freshWithinSeconds must be a positive finite number");
    }
    this.sourceId = sourceId;
    this.config = config;
  }

  /** Current recorded state without re-evaluating time drift. */
  get currentState(): HealthState {
    return this.state;
  }

  private ageSecondsOf(now: string): number | null {
    if (this.lastObservationAt === null) return null;
    return (parseIso(now, "now") - parseIso(this.lastObservationAt, "lastObservationAt")) / 1000;
  }

  /**
   * Record a refresh outcome. The outcome fully determines the next state:
   * success can never yield UNAVAILABLE except for the empty-result case,
   * and failure can never yield FRESH or STALE.
   */
  recordRefresh(outcome: RefreshOutcome): HealthState {
    parseIso(outcome.now, "now");

    if (this.lastRefreshAt !== null && parseIso(outcome.now, "now") < parseIso(this.lastRefreshAt, "lastRefreshAt")) {
      throw new Error("SourceHealthStateMachine: refresh events must be recorded in chronological order");
    }
    this.lastRefreshAt = outcome.now;

    if (outcome.status !== "failure" && outcome.lastObservationAt !== undefined) {
      parseIso(outcome.lastObservationAt, "lastObservationAt");
      const prev = this.lastObservationAt === null ? -Infinity : parseIso(this.lastObservationAt, "lastObservationAt");
      const next = parseIso(outcome.lastObservationAt, "lastObservationAt");
      if (next > prev) this.lastObservationAt = outcome.lastObservationAt;
    }

    if (outcome.status === "failure") {
      this.state = "UNAVAILABLE";
      this.detail = outcome.reason;
      return this.state;
    }

    if (outcome.status === "partial") {
      this.state = "DEGRADED";
      this.detail = `${outcome.reason} (${outcome.rejectedCount} record(s) rejected)`;
      return this.state;
    }

    // status === "ok"
    const age = this.ageSecondsOf(outcome.now);
    if (age === null) {
      this.state = "UNAVAILABLE";
      this.detail = "refresh succeeded but no observations are available (empty but honest state, plan section 6.2)";
      return this.state;
    }
    if (age <= this.config.freshWithinSeconds) {
      this.state = "FRESH";
      this.detail = null;
    } else {
      this.state = "STALE";
      this.detail = `newest observation is ${Math.round(age)}s old, beyond the ${this.config.freshWithinSeconds}s freshness threshold`;
    }
    return this.state;
  }

  /**
   * Re-evaluate the state against the passage of time. FRESH decays to STALE
   * once the newest observation ages past the threshold. Other states are
   * never silently upgraded (DEGRADED stays DEGRADED, §3.1) — only a recorded
   * refresh event can improve a source's health.
   */
  assess(now: string): HealthState {
    parseIso(now, "now");
    if (this.state === "FRESH") {
      const age = this.ageSecondsOf(now);
      if (age !== null && age > this.config.freshWithinSeconds) {
        this.state = "STALE";
        this.detail = `no new observations; newest is ${Math.round(age)}s old at assessment time`;
      }
    }
    return this.state;
  }

  snapshot(now: string): SourceHealthSnapshot {
    this.assess(now);
    const age = this.ageSecondsOf(now);
    return {
      state: this.state,
      lastRefreshAt: this.lastRefreshAt,
      lastObservationAt: this.lastObservationAt,
      ageSeconds: age === null ? null : Math.round(age),
      detail: this.detail,
    };
  }
}
