/**
 * Timeline and replay (CHOKEPOINT-PLAN.md §4.1, §12.5 "replay determinism",
 * §9.2 src/ui/timeline.ts).
 *
 * A pure, deterministic replay controller: the cursor advances by explicit
 * steps (never the wall clock), so replaying the same window with the same
 * steps yields identical positions — a Phase 3 exit criterion. Reaching the
 * window end pauses at the end; no wraparound surprises.
 */

export interface TimelineState {
  window: { startAt: string; endAt: string };
  cursor: string;
  playing: boolean;
  /** Replay seconds per real second. */
  speedMultiplier: number;
}

export const DEFAULT_REPLAY_LOOKBACK_SECONDS = 21600; // 6h: shows a full fixture timeline on first load

/** ISO with second precision when the ms part is zero (".000Z" -> "Z"), matching the rest of the data model. */
export function isoSecond(millis: number): string {
  return new Date(millis).toISOString().replace(".000Z", "Z");
}

export class TimelineController {
  private state: TimelineState;

  constructor(window: { startAt: string; endAt: string }, speedMultiplier = 60) {
    this.state = { window: { ...window }, cursor: window.startAt, playing: false, speedMultiplier };
  }

  get(): TimelineState {
    return this.state;
  }

  seek(iso: string): void {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) throw new Error(`invalid replay cursor: ${iso}`);
    const start = Date.parse(this.state.window.startAt);
    const end = Date.parse(this.state.window.endAt);
    const clamped = Math.min(end, Math.max(start, t));
    this.state = { ...this.state, cursor: isoSecond(clamped) };
  }

  play(): void {
    this.state = { ...this.state, playing: true };
  }

  pause(): void {
    this.state = { ...this.state, playing: false };
  }

  setSpeed(speedMultiplier: number): void {
    if (!(speedMultiplier > 0)) throw new Error("speedMultiplier must be positive");
    this.state = { ...this.state, speedMultiplier };
  }

  /**
   * Advance the cursor by real elapsed ms at the configured speed. Pure
   * function of (state, elapsed): replay determinism (§12.5).
   */
  advance(realElapsedMs: number): TimelineState {
    if (!this.state.playing) return this.state;
    const end = Date.parse(this.state.window.endAt);
    const cursor = Date.parse(this.state.cursor);
    const next = Math.min(end, cursor + (realElapsedMs / 1000) * this.state.speedMultiplier * 1000);
    this.state = { ...this.state, cursor: isoSecond(next), playing: next < end };
    return this.state;
  }

  setWindow(window: { startAt: string; endAt: string }): void {
    this.state = { ...this.state, window: { ...window }, cursor: window.startAt, playing: false };
  }
}

/**
 * The observation window for a replay cursor: a fixed look-back ending at the
 * cursor. Deterministic; feeds the manager snapshot calls during replay.
 */
export function replayWindow(
  cursorIso: string,
  lookbackSeconds = DEFAULT_REPLAY_LOOKBACK_SECONDS,
): { startAt: string; endAt: string } {
  const cursor = Date.parse(cursorIso);
  if (Number.isNaN(cursor)) throw new Error(`invalid replay cursor: ${cursorIso}`);
  return {
    startAt: isoSecond(cursor - lookbackSeconds * 1000),
    endAt: cursorIso,
  };
}
