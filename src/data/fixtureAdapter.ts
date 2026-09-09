/**
 * FixtureSourceAdapter — the fixture-mode implementation of the §5.1 source
 * adapter contract (CHOKEPOINT-PLAN.md §5.1, §6.2 keyless-first).
 *
 * Determinism: the adapter never reads the wall clock. Its timeline is the
 * fixture timeline — "serving time" is the newest receivedAt among accepted
 * records (the moment the fixture set was served), and freshness is measured
 * against the fixture's own observedAt values. `getStatusAt(now)` allows
 * tests and replay to assess health at any point on the fixture timeline.
 *
 * Provenance: all records are SIMULATED (§3.1); attribution and provenance
 * records state this explicitly.
 */

import {
  dedupeObservations,
  sortObservations,
  type TransportObservation,
} from "./observation";
import { provenanceForObservations, type ProvenanceRecord, FIXTURE_TRANSFORMATION_VERSION } from "./provenance";
import { parseFixture, type FixtureManifest } from "./fixtureLoader";
import { SourceHealthStateMachine } from "./sourceHealth";
import type {
  AttributionRecord,
  QueryScope,
  RefreshContext,
  SourceContext,
  SourceResult,
  SourceStatus,
  LicenseMetadata,
  SourceCapabilities,
  SourceAdapter,
} from "./sourceAdapter";

export const FIXTURE_ADAPTER_ID = "fixture-simulated";
export const DEFAULT_FIXTURE_FRESH_WITHIN_SECONDS = 1800;

export interface FixtureSourceAdapterOptions {
  /** The SIMULATED fixture manifests this adapter serves. */
  manifests: readonly FixtureManifest[];
  freshWithinSeconds?: number;
  id?: string;
}

function latestIso(times: readonly string[]): string | null {
  if (times.length === 0) return null;
  return times.reduce((a, b) => (a > b ? a : b));
}

export class FixtureSourceAdapter implements SourceAdapter<TransportObservation> {
  readonly id: string;
  readonly label = "Simulated fixture source (SIMULATED)";
  readonly license: LicenseMetadata = {
    licenseId: "CC0-1.0-synthetic",
    termsUrl: null,
    commercialUse: "permitted",
    attributionText: "Synthetic SIMULATED fixture data generated for Chokepoint; not real AIS data.",
    rawStorageAllowed: true,
    derivedStorageAllowed: true,
  };
  readonly capabilities: SourceCapabilities = {
    modes: ["sea"],
    entityTypes: ["cargo_vessel", "tanker", "bulk_carrier", "unknown"],
    providesPositions: true,
    providesClassification: true,
    maxRecordsPerRefresh: null,
    historicalRetention: "bounded",
  };

  private readonly manifests: readonly FixtureManifest[];
  private readonly freshWithinSeconds: number;
  private records: TransportObservation[] = [];
  private rejectedRecords: Array<{ reason: string; observationId?: string | undefined; fixtureId: string }> = [];
  private health: SourceHealthStateMachine;
  private servingTime: string | null = null;
  private enabled = false;
  private destroyed = false;

  constructor(options: FixtureSourceAdapterOptions) {
    if (options.manifests.length === 0) {
      throw new Error("FixtureSourceAdapter requires at least one fixture manifest");
    }
    this.manifests = [...options.manifests];
    this.freshWithinSeconds = options.freshWithinSeconds ?? DEFAULT_FIXTURE_FRESH_WITHIN_SECONDS;
    this.id = options.id ?? FIXTURE_ADAPTER_ID;
    this.health = new SourceHealthStateMachine(this.id, { freshWithinSeconds: this.freshWithinSeconds });
  }

  /** Parse manifests, normalize, dedupe, and sort. Rejected records are kept for diagnostics. */
  private ingest(): {
    accepted: TransportObservation[];
    rejected: Array<{ reason: string; observationId?: string | undefined; fixtureId: string }>;
  } {
    const raw: TransportObservation[] = [];
    const rejected: Array<{ reason: string; observationId?: string | undefined; fixtureId: string }> = [];
    for (const manifest of this.manifests) {
      const parsed = parseFixture(manifest); // throws if SIMULATED labeling is missing
      for (const observation of parsed.observations) raw.push(observation);
      for (const r of parsed.rejected) rejected.push({ ...r, fixtureId: manifest.fixtureId });
    }
    const { unique } = dedupeObservations(raw);
    return { accepted: sortObservations(unique), rejected };
  }

  /** Fixture-timeline serving time: newest receivedAt among accepted records. */
  private servingTimeOf(records: readonly TransportObservation[]): string | null {
    return latestIso(records.map((o) => o.receivedAt));
  }

  private recordHealth(
    outcomeStatus: SourceResult["status"],
    accepted: readonly TransportObservation[],
    now: string,
    message: string | null,
  ): SourceResult {
    const lastObservationAt = latestIso(accepted.map((o) => o.observedAt));
    if (outcomeStatus === "failure") {
      this.health.recordRefresh({ status: "failure", now, reason: message ?? "refresh failed" });
    } else if (outcomeStatus === "partial") {
      this.health.recordRefresh({
        status: "partial",
        now,
        lastObservationAt: lastObservationAt ?? undefined,
        rejectedCount: this.rejectedRecords.length,
        reason: message ?? "some fixture records were rejected during normalization",
      });
    } else {
      this.health.recordRefresh({
        status: "ok",
        now,
        lastObservationAt: lastObservationAt ?? undefined,
      });
    }
    return {
      status: outcomeStatus,
      acceptedCount: accepted.length,
      rejectedCount: this.rejectedRecords.length,
      lastObservationAt,
      message,
    };
  }

  async enable(context: SourceContext): Promise<SourceResult> {
    if (this.destroyed) throw new Error("FixtureSourceAdapter was destroyed and cannot be re-enabled");
    const { accepted, rejected } = this.ingest();
    this.records = accepted;
    this.rejectedRecords = rejected;
    this.servingTime = this.servingTimeOf(accepted) ?? context.now;
    this.enabled = true;
    const status: SourceResult["status"] = rejected.length > 0 ? "partial" : "ok";
    return this.recordHealth(
      status,
      accepted,
      this.servingTime,
      rejected.length > 0 ? `${rejected.length} fixture record(s) failed normalization` : null,
    );
  }

  async disable(): Promise<void> {
    this.enabled = false;
  }

  async refresh(context: RefreshContext): Promise<SourceResult> {
    if (!this.enabled) {
      return {
        status: "failure",
        acceptedCount: 0,
        rejectedCount: 0,
        lastObservationAt: null,
        message: "adapter is disabled",
      };
    }
    // Deterministic re-ingest: fixtures are immutable, so a refresh re-parses
    // the same manifests and health is re-recorded on the fixture timeline.
    const { accepted, rejected } = this.ingest();
    this.records = accepted;
    this.rejectedRecords = rejected;
    this.servingTime = this.servingTimeOf(accepted) ?? context.now;
    const status: SourceResult["status"] = rejected.length > 0 ? "partial" : "ok";
    return this.recordHealth(
      status,
      accepted,
      this.servingTime,
      rejected.length > 0 ? `${rejected.length} fixture record(s) failed normalization` : null,
    );
  }

  getStatus(): SourceStatus {
    if (this.destroyed) {
      return { state: "UNAVAILABLE", lastRefreshAt: null, lastObservationAt: null, ageSeconds: null, detail: "adapter destroyed" };
    }
    if (!this.enabled) {
      return { state: "UNAVAILABLE", lastRefreshAt: null, lastObservationAt: null, ageSeconds: null, detail: "adapter disabled" };
    }
    const snap = this.health.snapshot(this.servingTime ?? "1970-01-01T00:00:00Z");
    return snap;
  }

  /**
   * Assess health at an arbitrary point on the fixture timeline (tests/replay).
   * Exercises time drift: FRESH decays to STALE past the freshness threshold.
   */
  getStatusAt(now: string): SourceStatus {
    if (this.destroyed || !this.enabled) return this.getStatus();
    return this.health.snapshot(now);
  }

  getRecords(scope: QueryScope = {}): ReadonlyArray<TransportObservation> {
    if (this.destroyed || !this.enabled) return [];
    return this.records.filter((o) => {
      if (scope.modes && !scope.modes.includes(o.mode)) return false;
      if (scope.entityTypes && !scope.entityTypes.includes(o.entityType)) return false;
      if (scope.timeWindow) {
        if (o.observedAt < scope.timeWindow.startAt || o.observedAt > scope.timeWindow.endAt) return false;
      }
      return true;
    });
  }

  getAttribution(): AttributionRecord {
    return {
      providerName: "Chokepoint synthetic fixtures",
      endpointOrDatasetId: `fixture://${this.manifests.map((m) => m.fixtureId).join(",")}`,
      licenseId: this.license.licenseId,
      attributionText: this.license.attributionText,
      termsUrl: null,
      truthState: "SIMULATED",
      coverageNote: "Synthetic demonstration data on a fixed timeline. Not real AIS observations.",
    };
  }

  /**
   * One provenance record per provider/endpoint pair. A single-provider
   * fixture set yields exactly one record; multi-provider fixtures (e.g.
   * conflicting-sources) yield one per provider — conflicts stay visible.
   */
  getProvenancePerProvider(): ProvenanceRecord[] {
    if (this.records.length === 0) return [];
    const groups = new Map<string, TransportObservation[]>();
    for (const o of this.records) {
      const key = `${o.source.providerId}|${o.source.endpointId}`;
      const group = groups.get(key);
      if (group) group.push(o);
      else groups.set(key, [o]);
    }
    return [...groups.values()].map((group) =>
      provenanceForObservations(group, "SIMULATED", FIXTURE_TRANSFORMATION_VERSION, {
        freshnessThresholdSeconds: this.freshWithinSeconds,
        coverageNote: "Synthetic SIMULATED fixture data; not real AIS observations.",
      })
    );
  }

  /** Convenience for single-provider fixture sets. Throws on multi-provider sets. */
  getProvenance(): ProvenanceRecord {
    const records = this.getProvenancePerProvider();
    if (records.length === 0) throw new Error("no records loaded");
    if (records.length > 1) {
      throw new Error("multiple providers in fixture set — use getProvenancePerProvider()");
    }
    return records[0]!;
  }

  get fixtureIds(): string[] {
    return this.manifests.map((m) => m.fixtureId);
  }

  get rejected(): ReadonlyArray<{ reason: string; observationId?: string | undefined; fixtureId: string }> {
    return this.rejectedRecords;
  }

  destroy(): void {
    this.destroyed = true;
    this.enabled = false;
    this.records = [];
    this.rejectedRecords = [];
    this.servingTime = null;
    this.health = new SourceHealthStateMachine(this.id, { freshWithinSeconds: this.freshWithinSeconds });
  }
}
