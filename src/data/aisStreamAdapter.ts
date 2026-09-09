/**
 * AISStream live source adapter (§5.1 contract; ADR-0010; §14.1, §14.2).
 *
 * Phase 2 live transport. Responsibilities per the §5.1 contract: provider
 * request details, response validation (via AisStreamNormalizer), retry policy,
 * source-specific health, and attribution. It never owns UI, prompting, or
 * camera state.
 *
 * Security and terms posture (ADR-0010):
 *  - The API key is supplied by the host (server-side only, §14.1). It is never
 *    logged, never returned by getAttribution(), and never embedded in errors
 *    beyond an "missing key" hint that contains no key material.
 *  - No key configured -> enable() FAILS HONESTLY with UNAVAILABLE health. The
 *    application is expected to fall back to fixture mode (§6.2); a missing key
 *    must never make the app appear broken.
 *  - Raw frames are parsed and immediately discarded; only canonical
 *    observations enter the bounded in-memory buffer (<= maxRecords, TTL
 *    pruned; never persisted, never redistributed — ADR-0010).
 *  - Bounding boxes are REQUIRED by the provider and are DERIVED from the
 *    reviewed chokepoint fences — configuration stays data-driven (§4.3).
 *
 * Testability: the WebSocket transport is injected. Unit tests use a fake
 * socket; no test opens a network connection (CI runs keyless).
 *
 * NOTE the provider's box format is [lon, lat] pairs — the opposite of our
 * internal [lat, lon] rings. This is the documented coordinate-order pitfall;
 * see the conversion function below, which is tested.
 */

import {
  AisStreamNormalizer,
  AISSTREAM_ENDPOINT_ID,
  AISSTREAM_LICENSE_ID,
} from "./ais";
import { dedupeObservations, type TransportObservation } from "./observation";
import { SourceHealthStateMachine } from "./sourceHealth";
import { sortObservations } from "./observation";
import type {
  AttributionRecord,
  LicenseMetadata,
  QueryScope,
  RefreshContext,
  SourceCapabilities,
  SourceContext,
  SourceResult,
  SourceStatus,
  SourceAdapter,
} from "./sourceAdapter";
import type { ReviewedGeofence } from "./geofences";

export const AISSTREAM_ADAPTER_ID = "aisstream-live";

/**
 * Convert an internal [lat, lon] WGS84 ring to the provider's REQUIRED
 * bounding-box subscription format. The AISStream example sends
 * BoundingBoxes: [[[-180, -90], [180, 90]]] — that is [lon, lat] pairs.
 * Getting this backwards yields a silent global box or an empty stream, so it
 * is explicitly converted and tested.
 */
export function boundingBoxesFromFences(
  fences: readonly ReviewedGeofence[],
  paddingDegrees = 0.05,
): Array<[[number, number], [number, number]]> {
  if (fences.length === 0) throw new Error("boundingBoxesFromFences requires at least one reviewed fence");
  const boxes: Array<[[number, number], [number, number]]> = [];
  for (const fence of fences) {
    const lats: number[] = [];
    const lons: number[] = [];
    for (const v of fence.polygon) {
      lats.push(v[0]);
      lons.push(v[1]);
    }
    const pad = Math.abs(paddingDegrees);
    // Provider order: [lon, lat].
    boxes.push([
      [Math.min(...lons) - pad, Math.min(...lats) - pad],
      [Math.max(...lons) + pad, Math.max(...lats) + pad],
    ]);
  }
  return boxes;
}

export const AISSTREAM_SUBSCRIPTION_MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport",
] as const;

/** Minimal socket interface the adapter needs (satisfied by WebSocket). */
export interface AisStreamSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void;
}

export type SocketFactory = (url: string) => AisStreamSocket;

export interface AisStreamAdapterOptions {
  /** Server-side API key. Undefined -> honest UNAVAILABLE (fixture fallback). */
  apiKey?: string | undefined;
  /** Reviewed fences to subscribe to (bounding boxes are derived from them). */
  fences: readonly ReviewedGeofence[];
  /** Socket factory; defaults to the platform WebSocket. */
  socketFactory?: SocketFactory | undefined;
  /** Bounded in-memory buffer size (ADR-0010: no persistence). Default 5000. */
  maxRecords?: number | undefined;
  /** Record age beyond which entries are pruned on write (seconds). Default 72h (ADR-0010). */
  retentionSeconds?: number | undefined;
  /** Freshness threshold for health (seconds). Default 1800. */
  freshWithinSeconds?: number | undefined;
  /** Caller-supplied clock for deterministic TTL/latency handling. */
  nowFn?: () => string;
}

interface EventRecord {
  accepted: number;
  rejected: number;
  lastObservationAt: string | null;
  disconnected: boolean;
}

export class AisStreamAdapter implements SourceAdapter<TransportObservation> {
  readonly id: string;
  readonly label = "Live AIS via AISStream.io (OBSERVED)";
  readonly license: LicenseMetadata = {
    licenseId: AISSTREAM_LICENSE_ID,
    termsUrl: null,
    commercialUse: "unknown", // no published data-use terms; ADR-0010 risk acceptance
    attributionText: "Live AIS via AISStream.io. Coverage is community-receiver-based and incomplete; AIS does not represent every vessel.",
    rawStorageAllowed: "unknown", // no written terms; adapter keeps in-memory only
    derivedStorageAllowed: "unknown",
  };
  readonly capabilities: SourceCapabilities = {
    modes: ["sea"],
    entityTypes: ["cargo_vessel", "tanker", "bulk_carrier", "unknown"],
    providesPositions: true,
    providesClassification: true,
    maxRecordsPerRefresh: null,
    historicalRetention: "none", // live-only stream (ADR-0010)
  };

  private readonly apiKey: string | undefined;
  private readonly socketFactory: SocketFactory | undefined;
  private readonly fences: readonly ReviewedGeofence[];
  private readonly nowFn: (() => string) | undefined;
  private readonly maxRecords: number;
  private readonly retentionSeconds: number;
  private readonly freshWithinSeconds: number;
  private readonly normalizer = new AisStreamNormalizer();
  private health: SourceHealthStateMachine;
  private records: TransportObservation[] = [];
  private lastEvent: EventRecord = { accepted: 0, rejected: 0, lastObservationAt: null, disconnected: true };
  private servingTime: string | null = null;
  private socket: AisStreamSocket | null = null;
  private messageListener: ((event: { data?: unknown }) => void) | null = null;
  private openListener: (() => void) | null = null;
  private errorListener: (() => void) | null = null;
  private enabled = false;
  private destroyed = false;

  constructor(options: AisStreamAdapterOptions) {
    if (options.fences.length === 0) {
      throw new Error("AisStreamAdapter requires at least one reviewed fence to subscribe to");
    }
    this.apiKey = options.apiKey;
    this.socketFactory = options.socketFactory;
    this.fences = [...options.fences];
    this.nowFn = options.nowFn;
    this.maxRecords = options.maxRecords ?? 5000;
    this.retentionSeconds = options.retentionSeconds ?? 72 * 3600;
    this.freshWithinSeconds = options.freshWithinSeconds ?? 1800;
    this.id = AISSTREAM_ADAPTER_ID;
    this.health = new SourceHealthStateMachine(this.id, { freshWithinSeconds: this.freshWithinSeconds });
  }

  /** True when no key was supplied (honest-unavailable mode, §6.2). */
  get isKeyless(): boolean {
    return this.apiKey === undefined || this.apiKey.trim() === "";
  }

  private now(): string {
    return this.nowFn?.() ?? this.servingTime ?? "1970-01-01T00:00:00Z";
  }

  private ingestMessage(data: unknown, receivedAt: string): { accepted: number; rejected: number } {
    let accepted = 0;
    let rejected = 0;
    let parsed: unknown = data;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return { accepted: 0, rejected: 1 };
      }
    }
    const result = this.normalizer.normalize(parsed, receivedAt);
    if (result.kind === "observation") {
      this.records.push(result.observation);
      accepted = 1;
    } else if (result.kind === "invalid") {
      rejected = 1;
    }
    // classification-update and unsupported frames do not count as failures.
    return { accepted, rejected };
  }

  private prune(nowIso: string): void {
    // Bounded buffer + TTL (ADR-0010: in-memory only, short retention).
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(this.records.length - this.maxRecords);
    }
    const cutoff = Date.parse(nowIso) - this.retentionSeconds * 1000;
    this.records = this.records.filter((o) => Date.parse(o.receivedAt) >= cutoff);
  }

  private handleOpen(): void {
    if (!this.socket) return;
    const subscription = {
      APIkey: this.apiKey ?? "",
      BoundingBoxes: boundingBoxesFromFences(this.fences),
      FilterMessageTypes: [...AISSTREAM_SUBSCRIPTION_MESSAGE_TYPES],
    };
    this.socket.send(JSON.stringify(subscription));
  }

  private handleMessage(event: { data?: unknown }): void {
    if (!this.enabled) return;
    const receivedAt = this.now();
    const { accepted, rejected } = this.ingestMessage(event.data, receivedAt);
    this.lastEvent.accepted += accepted;
    this.lastEvent.rejected += rejected;
    this.prune(receivedAt);
    // Health: a flowing stream with at least one accepted record is "ok";
    // invalid frames only make it "partial".
    const newest = this.records.length > 0 ? this.records[this.records.length - 1]!.observedAt : undefined;
    if (accepted > 0) {
      this.health.recordRefresh({ status: "ok", now: receivedAt, lastObservationAt: newest });
    } else if (rejected > 0 && this.health.currentState === "NEVER_ANSWERED") {
      this.health.recordRefresh({
        status: "partial",
        now: receivedAt,
        rejectedCount: rejected,
        reason: "received frames but none normalized (check subscription bounding boxes and message types)",
      });
    }
    this.servingTime = receivedAt;
  }

  private handleError(reason: string): void {
    this.lastEvent.disconnected = true;
    this.health.recordRefresh({ status: "failure", now: this.now(), reason });
  }

  async enable(context: SourceContext): Promise<SourceResult> {
    if (this.destroyed) throw new Error("AisStreamAdapter was destroyed and cannot be re-enabled");
    if (this.enabled) return this.lastEnableResult("already enabled");

    if (this.isKeyless) {
      // Honest-unavailable: no key, no pretending (§6.2). Health records the failure.
      this.handleError("no AISStream API key configured; run in fixture mode (§6.2) or configure AISSTREAM_API_KEY server-side");
      return this.failureResult("no AISStream API key configured (honest empty state, §6.2)");
    }

    const factory = this.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as AisStreamSocket);
    this.socket = factory(AISSTREAM_ENDPOINT_ID);

    this.openListener = () => {
      this.lastEvent.disconnected = false;
      this.handleOpen();
    };
    this.messageListener = (event) => this.handleMessage(event);
    this.errorListener = () => this.handleError("socket error");

    this.socket.addEventListener("open", this.openListener as (event: { data?: unknown }) => void);
    this.socket.addEventListener("message", this.messageListener);
    this.socket.addEventListener("error", this.errorListener);

    this.enabled = true;
    this.servingTime = context.now;
    // A freshly opened socket has no data yet: NEVER_ANSWERED until frames
    // arrive. That is the honest state (§3.1) — not FRESH.
    return this.lastEnableResult("enabled; awaiting first frames");
  }

  private lastEnableResult(message: string): SourceResult {
    return {
      status: this.lastEvent.disconnected && this.lastEvent.accepted === 0 ? "failure" : "ok",
      acceptedCount: this.lastEvent.accepted,
      rejectedCount: this.lastEvent.rejected,
      lastObservationAt: this.lastEvent.lastObservationAt,
      message,
    };
  }

  private failureResult(message: string): SourceResult {
    return { status: "failure", acceptedCount: 0, rejectedCount: 0, lastObservationAt: null, message };
  }

  async disable(): Promise<void> {
    this.detachSocket();
    this.enabled = false;
  }

  async refresh(context: RefreshContext): Promise<SourceResult> {
    if (this.destroyed) return this.failureResult("adapter destroyed");
    if (!this.enabled) return this.failureResult("adapter is disabled");
    this.servingTime = context.now;
    this.prune(context.now);
    const disconnected = this.lastEvent.disconnected;
    this.health.recordRefresh(
      disconnected
        ? { status: "failure", now: context.now, reason: "socket disconnected" }
        : this.lastEvent.accepted > 0
          ? { status: "ok", now: context.now, lastObservationAt: this.lastEvent.lastObservationAt ?? undefined }
          : {
              status: "partial",
              now: context.now,
              rejectedCount: this.lastEvent.rejected,
              lastObservationAt: this.lastEvent.lastObservationAt ?? undefined,
              reason: "connected but no records accepted yet",
            },
    );
    return this.lastEnableResult("refresh");
  }

  getStatus(): SourceStatus {
    if (this.destroyed) {
      return { state: "UNAVAILABLE", lastRefreshAt: null, lastObservationAt: null, ageSeconds: null, detail: "adapter destroyed" };
    }
    if (!this.enabled) {
      return {
        state: "UNAVAILABLE",
        lastRefreshAt: null,
        lastObservationAt: null,
        ageSeconds: null,
        // Honest reasons (§6.2): a missing key is NOT the same as a generic
        // disabled adapter — operators should see exactly why there is no data.
        detail: this.isKeyless
          ? "no AISStream API key configured (honest empty state, §6.2); fixture mode is the fallback"
          : "adapter disabled",
      };
    }
    return this.health.snapshot(this.now());
  }

  /** Health assessed at an arbitrary time (tests/replay). */
  getStatusAt(now: string): SourceStatus {
    if (this.destroyed || !this.enabled) return this.getStatus();
    return this.health.snapshot(now);
  }

  getRecords(scope: QueryScope = {}): ReadonlyArray<TransportObservation> {
    if (this.destroyed || !this.enabled) return [];
    const filtered = this.records.filter((o) => {
      if (scope.modes && !scope.modes.includes(o.mode)) return false;
      if (scope.entityTypes && !scope.entityTypes.includes(o.entityType)) return false;
      if (scope.timeWindow && (o.observedAt < scope.timeWindow.startAt || o.observedAt > scope.timeWindow.endAt)) return false;
      return true;
    });
    return sortObservations(dedupeObservations(filtered).unique);
  }

  getAttribution(): AttributionRecord {
    return {
      providerName: "AISStream.io",
      endpointOrDatasetId: AISSTREAM_ENDPOINT_ID,
      licenseId: AISSTREAM_LICENSE_ID,
      attributionText: this.license.attributionText,
      termsUrl: null, // provider publishes no terms page (verified 2026-09-09; ADR-0010)
      truthState: "OBSERVED",
      coverageNote:
        "Live community-receiver AIS coverage; blind spots undocumented. Vessels outside receiver coverage are invisible. Bounding boxes follow the reviewed chokepoint fences (v1).",
    };
  }

  /** Diagnostics only — NEVER includes the API key (§14.1). */
  getDiagnostics(): Record<string, unknown> {
    return {
      id: this.id,
      connected: !this.lastEvent.disconnected,
      bufferedRecords: this.records.length,
      classifiedEntities: this.normalizer.cachedEntityCount,
      acceptedTotal: this.lastEvent.accepted,
      rejectedTotal: this.lastEvent.rejected,
      boundingBoxes: boundingBoxesFromFences(this.fences),
    };
  }

  private detachSocket(): void {
    if (this.socket) {
      if (this.openListener) this.socket.removeEventListener("open", this.openListener as (event: { data?: unknown }) => void);
      if (this.messageListener) this.socket.removeEventListener("message", this.messageListener);
      if (this.errorListener) this.socket.removeEventListener("error", this.errorListener);
      try {
        this.socket.close();
      } catch {
        // closing an already-closed socket is not an error
      }
      this.socket = null;
    }
    this.openListener = this.messageListener = this.errorListener = null;
  }

  destroy(): void {
    this.detachSocket();
    this.destroyed = true;
    this.enabled = false;
    this.records = [];
    this.servingTime = null;
    this.health = new SourceHealthStateMachine(this.id, { freshWithinSeconds: this.freshWithinSeconds });
  }
}
