/**
 * Application startup (CHOKEPOINT-PLAN.md §9.2 src/app/startup.ts, §9.3).
 *
 * Boot order (deterministic, no wall clock): create state -> create the data
 * manager (fixture mode; live adapter only with a host-supplied key) -> apply
 * a share link when the URL carries one (§11.2) -> render the launcher.
 */

import { AppState } from "./appState";
import { decodeShareState, type DecodedShareState } from "./shareState";
import { createDataManager, type DataManager } from "../data/manager";
import type { SourceMode } from "./appState";

export interface Startup {
  state: AppState;
  manager: DataManager;
}

export async function startup(options: {
  mode?: SourceMode;
  apiKey?: string;
  /** Current location hash, if the app was opened from a share link. */
  shareHash?: string | undefined;
  nowFn?: () => string;
  /** Browser path: preloaded SIMULATED fixture manifests. */
  manifests?: readonly import("../data/fixtureLoader").FixtureManifest[] | undefined;
}): Promise<Startup> {
  const mode: SourceMode = options.mode ?? "fixture";
  const manager = await createDataManager({
    mode,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.nowFn !== undefined ? { nowFn: options.nowFn } : {}),
    ...(options.manifests !== undefined ? { manifests: options.manifests } : {}),
  });
  const state = new AppState(mode);

  const shared: DecodedShareState | null = options.shareHash ? decodeShareState(options.shareHash) : null;
  if (shared) {
    state.update({
      ...(shared.chokepointId ? { chokepointId: shared.chokepointId } : {}),
      ...(shared.timeWindow ? { timeWindow: shared.timeWindow } : {}),
      ...(shared.replayCursor ? { replay: { cursor: shared.replayCursor } } : {}),
      ...(shared.selectedEventId ? { selectedEventId: shared.selectedEventId } : {}),
      ...(shared.selectedEntityId ? { selectedEntityId: shared.selectedEntityId } : {}),
      sourceMode: shared.sourceMode,
      overlays: shared.overlays,
    });
  }
  return { state, manager };
}

