/**
 * Provenance records (CHOKEPOINT-PLAN.md §3.2).
 *
 * Each displayed metric and AI claim must be traceable to: provider name,
 * provider endpoint/dataset id, retrieval timestamp, source observation
 * timestamp or interval, geographic scope or geofence version,
 * transformation/version id, data freshness threshold, coverage notes,
 * license and attribution id, and the truth state.
 */

import type { TransportObservation } from "./observation";
import type { TruthState } from "./truthState";

export interface ProvenanceRecord {
  providerId: string;
  endpointId: string;
  /** When the record set was received from the provider (§3.3: never replaces observedAt). */
  retrievedAt: string;
  /** Observed-time interval covered by the record set. */
  observationInterval: { startAt: string; endAt: string };
  /** Geofence version the scope was evaluated against, when applicable. */
  geofenceVersion: string | null;
  /** Versioned identifier of the transformation that produced this record set. */
  transformationVersion: string;
  /** Freshness threshold applied at capture time, when one applies. */
  freshnessThresholdSeconds: number | null;
  coverageNote: string;
  licenseId: string;
  truthState: TruthState;
  /** Observation ids covered by this provenance record. */
  observationIds: string[];
}

/** Version tag for the fixture-mode transformation (observed fixtures only). */
export const FIXTURE_TRANSFORMATION_VERSION = "fixture-loader-v1";

export interface ProvenanceOptions {
  geofenceVersion?: string | undefined;
  freshnessThresholdSeconds?: number | undefined;
  coverageNote?: string | undefined;
}

/**
 * Build one provenance record for a set of observations from a single provider.
 * Throws on an empty set or mixed providers — callers must split conflicting
 * multi-provider data into one record per provider (§3.3: conflicts stay
 * visible, never merged away).
 */
export function provenanceForObservations(
  observations: readonly TransportObservation[],
  truthState: TruthState,
  transformationVersion: string,
  options: ProvenanceOptions = {},
): ProvenanceRecord {
  if (observations.length === 0) {
    throw new Error("provenanceForObservations: cannot build a provenance record from zero observations");
  }
  const providerIds = new Set(observations.map((o) => o.source.providerId));
  if (providerIds.size !== 1) {
    throw new Error(
      `provenanceForObservations: mixed providers ${[...providerIds].join(", ")} — split into one record per provider`
    );
  }
  const endpointIds = new Set(observations.map((o) => o.source.endpointId));
  if (endpointIds.size !== 1) {
    throw new Error("provenanceForObservations: mixed endpointIds within one provider — split the record set");
  }
  const licenseIds = new Set(observations.map((o) => o.source.licenseId));
  if (licenseIds.size !== 1) {
    throw new Error("provenanceForObservations: mixed licenseIds — split the record set");
  }

  const times = observations.map((o) => o.observedAt).sort();
  const received = observations.map((o) => o.receivedAt).sort();
  const last = observations[observations.length - 1]!;

  return {
    providerId: last.source.providerId,
    endpointId: last.source.endpointId,
    retrievedAt: received[received.length - 1]!,
    observationInterval: { startAt: times[0]!, endAt: times[times.length - 1]! },
    geofenceVersion: options.geofenceVersion ?? null,
    transformationVersion,
    freshnessThresholdSeconds: options.freshnessThresholdSeconds ?? null,
    coverageNote: options.coverageNote ?? "",
    licenseId: last.source.licenseId,
    truthState,
    observationIds: observations.map((o) => o.observationId),
  };
}
