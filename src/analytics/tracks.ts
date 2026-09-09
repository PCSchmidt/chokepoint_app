/**
 * Track segmentation (CHOKEPOINT-PLAN.md §5.3, §7, §17 Phase 2).
 *
 * Tracks preserve raw observations and derived interpolation SEPARATELY. This
 * Phase 2 implementation performs segmentation only: gaps larger than
 * maxGapSeconds start a new segment, and interpolation is "none" — no
 * synthetic positions are ever created, so interpolatedPointCount is always 0
 * and interpolated positions can never masquerade as observed (§5.3).
 */

import type { TransportObservation } from "../data/observation";
import { sortObservations } from "../data/observation";

/** The §5.3 track model. */
export interface TrackSegment {
  trackId: string;
  entityId: string;
  observations: string[];
  startAt: string;
  endAt: string;
  interpolation: {
    method: "none" | "linear" | "kinematic";
    maxGapSeconds: number;
  };
  quality: {
    observedPointCount: number;
    interpolatedPointCount: number;
    largestGapSeconds: number;
    sourceState: string;
  };
}

export interface TrackBuildOptions {
  /** Gaps strictly larger than this split into a new segment. */
  maxGapSeconds: number;
}

const SOURCE_STATE_ORDER = { fresh: 0, stale: 1, degraded: 2, unavailable: 3 } as const;
type OrderedSourceState = keyof typeof SOURCE_STATE_ORDER;

/**
 * Aggregate the source state of a segment deterministically: the WORST state
 * present wins (§3.1 — degraded data must stay labeled degraded).
 */
function aggregateSourceState(observations: readonly TransportObservation[]): OrderedSourceState {
  let worst: OrderedSourceState = "fresh";
  for (const o of observations) {
    const s = o.quality.sourceState as OrderedSourceState;
    if (SOURCE_STATE_ORDER[s] > SOURCE_STATE_ORDER[worst]) worst = s;
  }
  return worst;
}

function gapSeconds(aObservedAt: string, bObservedAt: string): number {
  return (Date.parse(bObservedAt) - Date.parse(aObservedAt)) / 1000;
}

/**
 * Build track segments per entity. Observations must already be normalized;
 * ordering is applied internally so input order never matters (§12.1).
 *
 * Determinism: segment ids derive from entityId + segment start time, so the
 * same observations always produce the same segments in the same order.
 */
export function buildTracks(
  observations: readonly TransportObservation[],
  options: TrackBuildOptions,
): TrackSegment[] {
  if (!(options.maxGapSeconds > 0)) {
    throw new Error("maxGapSeconds must be a positive number");
  }
  const byEntity = new Map<string, TransportObservation[]>();
  for (const o of sortObservations(observations)) {
    const list = byEntity.get(o.entityId);
    if (list) list.push(o);
    else byEntity.set(o.entityId, [o]);
  }

  const tracks: TrackSegment[] = [];
  for (const entityId of [...byEntity.keys()].sort()) {
    const entityObservations = byEntity.get(entityId)!;
    let current: TransportObservation[] = [];
    let largestGap = 0;

    const flush = () => {
      if (current.length === 0) return;
      const first = current[0]!;
      const last = current[current.length - 1]!;
      tracks.push({
        trackId: `${entityId}@${first.observedAt}`,
        entityId,
        observations: current.map((o) => o.observationId),
        startAt: first.observedAt,
        endAt: last.observedAt,
        interpolation: { method: "none", maxGapSeconds: options.maxGapSeconds },
        quality: {
          observedPointCount: current.length,
          interpolatedPointCount: 0, // no interpolation exists in Phase 2 segmentation
          largestGapSeconds: largestGap,
          sourceState: aggregateSourceState(current),
        },
      });
      current = [];
      largestGap = 0;
    };

    for (const o of entityObservations) {
      if (current.length > 0) {
        const gap = gapSeconds(current[current.length - 1]!.observedAt, o.observedAt);
        if (gap > options.maxGapSeconds) {
          flush();
        } else {
          largestGap = Math.max(largestGap, gap);
        }
      }
      current.push(o);
    }
    flush();
  }
  return tracks;
}
