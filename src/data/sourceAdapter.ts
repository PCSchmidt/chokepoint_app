/**
 * Source adapter contract (CHOKEPOINT-PLAN.md §5.1).
 *
 * Each source module owns: provider request details, response validation,
 * normalization into the canonical schema, retry/backoff and cache policy,
 * source-specific health and freshness, and attribution metadata.
 * It must NOT own global UI layout, AI prompting, or unrelated camera state.
 *
 * No live adapter exists yet (all §6.1 terms decisions are TBD, see
 * DATA_SOURCES.md). The interface is proven against FixtureSourceAdapter
 * (src/data/fixtureAdapter.ts) before any live provider is integrated.
 */

import type { EntityType, TransportMode } from "./observation";
import type { TruthState } from "./truthState";

export interface LicenseMetadata {
  licenseId: string;
  termsUrl: string | null;
  commercialUse: "permitted" | "restricted" | "unknown";
  attributionText: string;
  /** §6.1 gate: unknown until the terms decision is made. */
  rawStorageAllowed: boolean | "unknown";
  derivedStorageAllowed: boolean | "unknown";
}

export interface SourceCapabilities {
  modes: readonly TransportMode[];
  entityTypes: readonly EntityType[];
  providesPositions: boolean;
  providesClassification: boolean;
  /** Null means the source does not declare a per-refresh record cap. */
  maxRecordsPerRefresh: number | null;
  historicalRetention: "none" | "bounded" | "unknown";
}

export interface QueryScope {
  /** Inclusive observation window on observedAt. */
  timeWindow?: { startAt: string; endAt: string } | undefined;
  modes?: readonly TransportMode[] | undefined;
  entityTypes?: readonly EntityType[] | undefined;
}

export interface SourceContext {
  now: string;
  /** Why the adapter is being enabled. */
  trigger: "startup" | "manual";
}

export interface RefreshContext {
  now: string;
  trigger: "scheduled" | "manual" | "startup";
}

export interface SourceResult {
  status: "ok" | "partial" | "failure";
  acceptedCount: number;
  rejectedCount: number;
  lastObservationAt: string | null;
  /** Empty result on a successful refresh is honest, not an error (§6.2). */
  message: string | null;
}

export interface SourceStatus {
  state: "FRESH" | "STALE" | "DEGRADED" | "UNAVAILABLE" | "NEVER_ANSWERED";
  lastRefreshAt: string | null;
  lastObservationAt: string | null;
  ageSeconds: number | null;
  detail: string | null;
}

export interface AttributionRecord {
  providerName: string;
  endpointOrDatasetId: string;
  licenseId: string;
  attributionText: string;
  termsUrl: string | null;
  truthState: TruthState;
  coverageNote: string;
}

export interface SourceAdapter<TRecord> {
  id: string;
  label: string;
  license: LicenseMetadata;
  capabilities: SourceCapabilities;
  enable(context: SourceContext): Promise<SourceResult>;
  disable(): Promise<void>;
  refresh(context: RefreshContext): Promise<SourceResult>;
  getStatus(): SourceStatus;
  getRecords(scope: QueryScope): ReadonlyArray<TRecord>;
  getAttribution(): AttributionRecord;
  destroy(): void;
}
