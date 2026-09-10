/**
 * Application state (CHOKEPOINT-PLAN.md §9.2 src/app, §11.2 share state).
 *
 * A tiny deterministic store: immutable snapshots, explicit patches, ordered
 * notifications. No framework — this is the single source of truth the scene,
 * HUD, timeline, and evidence drawer read. The wall clock is never read here:
 * time windows and replay cursors come from data or explicit input.
 *
 * Share state must not include API keys, private user data, unbounded raw
 * observations, or voice transcripts (§11.2) — this state type contains only
 * ids, windows, and mode flags, all encodable (see shareState.ts).
 */

export type SourceMode = "fixture" | "live";

export interface ReplayState {
  playing: boolean;
  /** Replay cursor as ISO time; null = follow the window end. */
  cursor: string | null;
  speedMultiplier: number;
}

export interface TimeWindow {
  startAt: string;
  endAt: string;
}

export interface AppStateSnapshot {
  /** Selected chokepoint (§4.3 id); null = mission launcher view. */
  chokepointId: string | null;
  timeWindow: TimeWindow | null;
  replay: ReplayState;
  selectedEventId: string | null;
  selectedEntityId: string | null;
  sourceMode: SourceMode;
  /** Visible overlay toggles (bounded, data-driven). */
  overlays: {
    vessels: boolean;
    eventCards: boolean;
    density: boolean;
  };
}

export interface AppStatePatch {
  chokepointId?: string | null;
  timeWindow?: TimeWindow | null;
  replay?: Partial<ReplayState>;
  selectedEventId?: string | null;
  selectedEntityId?: string | null;
  sourceMode?: SourceMode;
  overlays?: Partial<AppStateSnapshot["overlays"]>;
}

export type AppStateListener = (snapshot: AppStateSnapshot) => void;

export const DEFAULT_REPLAY_SPEED = 60; // 1 real second = 60 replay seconds

export function initialAppState(sourceMode: SourceMode = "fixture"): AppStateSnapshot {
  return {
    chokepointId: null,
    timeWindow: null,
    replay: { playing: false, cursor: null, speedMultiplier: DEFAULT_REPLAY_SPEED },
    selectedEventId: null,
    selectedEntityId: null,
    sourceMode,
    overlays: { vessels: true, eventCards: true, density: false },
  };
}

export class AppState {
  private snapshot: AppStateSnapshot;
  private readonly listeners = new Set<AppStateListener>();

  constructor(sourceMode: SourceMode = "fixture") {
    this.snapshot = initialAppState(sourceMode);
  }

  get(): AppStateSnapshot {
    return this.snapshot;
  }

  /**
   * Apply a patch immutably. Selecting a chokepoint resets stale event/entity
   * selections (they belong to the previous investigation).
   */
  update(patch: AppStatePatch): AppStateSnapshot {
    const previous = this.snapshot;
    const switchedChokepoint =
      patch.chokepointId !== undefined && patch.chokepointId !== previous.chokepointId;
    const next: AppStateSnapshot = {
      ...previous,
      ...(patch.chokepointId !== undefined ? { chokepointId: patch.chokepointId } : {}),
      ...(patch.timeWindow !== undefined ? { timeWindow: patch.timeWindow } : {}),
      replay: patch.replay ? { ...previous.replay, ...patch.replay } : previous.replay,
      ...(patch.selectedEventId !== undefined ? { selectedEventId: patch.selectedEventId } : {}),
      ...(patch.selectedEntityId !== undefined ? { selectedEntityId: patch.selectedEntityId } : {}),
      ...(patch.sourceMode !== undefined ? { sourceMode: patch.sourceMode } : {}),
      overlays: patch.overlays ? { ...previous.overlays, ...patch.overlays } : previous.overlays,
    };
    if (switchedChokepoint) {
      // Fresh investigation: clear selections from the previous chokepoint.
      next.selectedEventId = null;
      next.selectedEntityId = null;
    }
    this.snapshot = next;
    this.notify();
    return this.snapshot;
  }

  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: AppStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
