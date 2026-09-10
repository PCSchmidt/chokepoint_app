/**
 * Share-link state (CHOKEPOINT-PLAN.md §11.2, §9.2 src/app/shareState.ts).
 *
 * Encodes the §11.2-allowed fields into a URL hash fragment; never encodes
 * API keys, credentials, private data, unbounded observations, or voice
 * transcripts — this module simply has no field for them (enforced by the
 * narrow encode type).
 *
 * Format: URLSearchParams in the URL hash (#c=...&t0=...&t1=...&r=...&e=...&v=...&m=...&o=...)
 * so it survives static hosting and stays copy-pasteable. Missing overlay
 * flags decode to the app defaults (vessels and event cards on), never to a
 * silently blank map.
 */

import type { AppStateSnapshot } from "./appState";

export interface ShareState {
  chokepointId: string | null;
  timeWindow: { startAt: string; endAt: string } | null;
  replayCursor: string | null;
  selectedEventId: string | null;
  selectedEntityId: string | null;
  sourceMode: "fixture" | "live";
  overlays: { vessels: boolean; eventCards: boolean; density: boolean };
}

export function toShareState(snapshot: {
  chokepointId: string | null;
  timeWindow: { startAt: string; endAt: string } | null;
  replay: { cursor: string | null };
  selectedEventId: string | null;
  selectedEntityId: string | null;
  sourceMode: "fixture" | "live";
  overlays: { vessels: boolean; eventCards: boolean; density: boolean };
}): ShareState {
  return {
    chokepointId: snapshot.chokepointId,
    timeWindow: snapshot.timeWindow ? { ...snapshot.timeWindow } : null,
    replayCursor: snapshot.replay.cursor,
    selectedEventId: snapshot.selectedEventId,
    selectedEntityId: snapshot.selectedEntityId,
    sourceMode: snapshot.sourceMode,
    overlays: { ...snapshot.overlays },
  };
}

export function encodeShareState(share: ShareState): string {
  const params = new URLSearchParams();
  if (share.chokepointId) params.set("c", share.chokepointId);
  if (share.timeWindow) {
    params.set("t0", share.timeWindow.startAt);
    params.set("t1", share.timeWindow.endAt);
  }
  if (share.replayCursor) params.set("r", share.replayCursor);
  if (share.selectedEventId) params.set("e", share.selectedEventId);
  if (share.selectedEntityId) params.set("v", share.selectedEntityId);
  params.set("m", share.sourceMode);
  const bits =
    (share.overlays.vessels ? "v" : "") +
    (share.overlays.eventCards ? "e" : "") +
    (share.overlays.density ? "d" : "");
  if (bits) params.set("o", bits);
  return params.toString();
}

export function shareUrl(base: string, snapshot: Parameters<typeof toShareState>[0]): string {
  return `${base}#${encodeShareState(toShareState(snapshot))}`;
}

export interface DecodedShareState {
  chokepointId: string | null;
  timeWindow: { startAt: string; endAt: string } | null;
  replayCursor: string | null;
  selectedEventId: string | null;
  selectedEntityId: string | null;
  sourceMode: "fixture" | "live";
  overlays: { vessels: boolean; eventCards: boolean; density: boolean };
}

/**
 * Decode a share hash. Invalid input (bad timestamps, half a window, garbage)
 * returns null — the caller degrades to the mission launcher honestly, never
 * to a half-broken state.
 */
export function decodeShareState(hash: string): DecodedShareState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw.length === 0) return null;
  const params = new URLSearchParams(raw);
  const t0 = params.get("t0");
  const t1 = params.get("t1");
  if ((t0 && Number.isNaN(Date.parse(t0))) || (t1 && Number.isNaN(Date.parse(t1)))) return null;
  if ((t0 && !t1) || (!t0 && t1)) return null;
  const overlayBits = params.get("o");
  return {
    chokepointId: params.get("c"),
    timeWindow: t0 && t1 ? { startAt: t0, endAt: t1 } : null,
    replayCursor: params.get("r"),
    selectedEventId: params.get("e"),
    selectedEntityId: params.get("v"),
    sourceMode: params.get("m") === "live" ? "live" : "fixture",
    overlays:
      overlayBits === null
        ? { vessels: true, eventCards: true, density: false } // §-sane defaults
        : {
            vessels: overlayBits.includes("v"),
            eventCards: overlayBits.includes("e"),
            density: overlayBits.includes("d"),
          },
  };
}

/** Full round-trip from an AppStateSnapshot. */
export function shareFromAppState(snapshot: AppStateSnapshot): string {
  return encodeShareState(toShareState(snapshot));
}
