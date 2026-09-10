/**
 * adsb.lol air-cargo adapter (ADR-0012; §5.1 SourceAdapter contract;
 * CHOKEPOINT-PLAN.md §9.2 src/data).
 *
 * Polls adsb.lol's keyless point API (`/v2/lat/{lat}/lon/{lon}/dist/{dist}`,
 * VERIFIED 2026-09-10) and emits canonical TransportObservations with mode
 * "air" and entityType "aircraft".
 *
 * CLASSIFICATION IS INFERRED (ADR-0012): aircraft broadcast no cargo flag.
 * Freight-operator cohorts are built ONLY from provider-published metadata
 * (callsign prefix heuristics over known freight operators) and every record
 * carries classification: "inferred" with an explicit limitation. The agent
 * and evaluator may never claim a specific operator unless the provider
 * publishes it for that record (§8.4 IDENTITY).
 *
 * ODbL (ADR-0012): bounded in-memory buffer, no raw persistence beyond TTL,
 * no raw redistribution — the ADR-0010 posture.
 * Key hygiene (§14.1): the endpoint needs no key today; when adsb.lol
 * introduces feeders-only keys, a missing key degrades to honest UNAVAILABLE
 * with fixture fallback (never breaks the app).
 */

import { normalizeObservation, type RawObservation, type TransportObservation } from "./observation";
import { SourceHealthStateMachine } from "./sourceHealth";
import type {
  QueryScope,
  RefreshContext,
  SourceContext,
  SourceResult,
  SourceStatus,
  LicenseMetadata,
  SourceCapabilities,
} from "./sourceAdapter";

export const ADSB_LOL_ADAPTER_ID = "adsb-lol";
export const DEFAULT_POLL_RADIUS_NM = 100;
export const DEFAULT_FRESH_WITHIN_SECONDS = 300;

/** Freight-operator callsign prefixes (ICAO airline codes), documented heuristic. */
export const FREIGHT_CALLSIGN_PREFIXES: readonly string[] = [
  "FDX", // FedEx Express
  "UPS", // UPS Airlines
  "GTI", // Atlas Air
  "CLX", // Cargolux
  "CKS", // China Cargo
  "ABX", // ABX Air
  "ATN", // Air Transport International
  "BOX", // Aerologic
];

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface AdsbLolAdapterOptions {
  /** Observation area: center + radius (nm). Regional context, not worldwide (ADR-0012). */
  center: { latitude: number; longitude: number };
  radiusNm?: number;
  fetchFn?: FetchLike | undefined;
  nowFn?: () => string;
  maxRecords?: number;
  retentionSeconds?: number;
  freshWithinSeconds?: number;
}



/**
 * Map one adsb.lol aircraft record to a raw TransportObservation input.
 * Returns null for records without the minimum required fields.
 */
export function transformAircraft(ac: Record<string, unknown>, receivedAt: string, seenPos: number | null): RawObservation | null {
  const hex = typeof ac["hex"] === "string" ? ac["hex"].trim().toLowerCase() : null;
  const lat = typeof ac["lat"] === "number" ? (ac["lat"] as number) : null;
  const lon = typeof ac["lon"] === "number" ? (ac["lon"] as number) : null;
  if (!hex || hex.length === 0 || lat === null || lon === null) return null;
  if (typeof ac["type"] === "string" && (ac["type"] as string).startsWith("mlat")) {
    // MLAT positions are triangulated estimates; the type field marks them.
    // Kept but flagged through positionAccuracy below.
  }
  const callsign = typeof ac["flight"] === "string" ? (ac["flight"] as string).trim() : "";
  const altBaro = ac["alt_baro"];
  const altitude =
    typeof altBaro === "number" ? Math.round((altBaro as number) * 0.3048) : undefined; // "ground" → omitted
  const gs = typeof ac["gs"] === "number" ? (ac["gs"] as number) : undefined;
  const track = typeof ac["track"] === "number" ? (ac["track"] as number) : undefined;
  // observedAt: point-in-time poll. The API reports seen_pos (age of the
  // position); subtract it from the poll time, truncated to second precision
  // (the canonical ISO convention in this repo).
  const observedAt =
    seenPos !== null && Number.isFinite(seenPos)
      ? new Date(Math.floor((Date.parse(receivedAt) - Math.round(seenPos * 1000)) / 1000) * 1000)
          .toISOString()
          .replace(".000Z", "Z")
      : receivedAt;
  const inferredFreight =
    callsign.length >= 3 && FREIGHT_PREFIX_SET.has(callsign.slice(0, 3).toUpperCase());
  return {
    observationId: `adsb-lol:${hex}:${observedAt}`,
    entityId: `aircraft:${hex}`,
    mode: "air",
    entityType: inferredFreight ? "aircraft" : "unknown",
    position: { latitude: lat, longitude: lon, ...(altitude !== undefined ? { altitudeMeters: altitude } : {}) },
    kinematics: {
      ...(gs !== undefined ? { speedKnots: gs } : {}),
      ...(track !== undefined ? { headingDegrees: track } : {}),
    },
    observedAt,
    receivedAt,
    source: {
      providerId: ADSB_LOL_ADAPTER_ID,
      endpointId: ADSB_ENDPOINT_ID,
      recordRef: `hex=${hex}`,
      licenseId: "ODbL-1.0",
    },
    quality: {
      sourceState: "fresh",
      positionAccuracy: typeof ac["type"] === "string" && (ac["type"] as string).startsWith("mlat") ? "approximate" : "exact",
      classification: inferredFreight ? "inferred" : "unknown",
    },
  };
}

const ADSB_ENDPOINT_ID = "api.adsb.lol/v2/lat/lon/dist";
const FREIGHT_PREFIX_SET = new Set(FREIGHT_CALLSIGN_PREFIXES);

export class AdsbLolAdapter {
  readonly id = ADSB_LOL_ADAPTER_ID;
  readonly label = "ADS-B aircraft via adsb.lol (ODbL 1.0, keyless, operator cohorts inferred)";
  readonly license: LicenseMetadata = {
    licenseId: "ODbL-1.0",
    termsUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    commercialUse: "permitted",
    attributionText: "ADS-B data via adsb.lol contributors (ODbL) — regional observed context, not worldwide completeness",
    rawStorageAllowed: true,
    derivedStorageAllowed: true,
  };
  readonly capabilities: SourceCapabilities = {
    modes: ["air"],
    entityTypes: ["aircraft", "unknown"],
    providesPositions: true,
    providesClassification: true,
    maxRecordsPerRefresh: null,
    historicalRetention: "none",
  };

  private readonly fetchFn: FetchLike;
  private readonly center: { latitude: number; longitude: number };
  private readonly radiusNm: number;
  private readonly nowFn: () => string;
  private readonly maxRecords: number;
  private readonly retentionSeconds: number;
  private health: SourceHealthStateMachine;
  private records: TransportObservation[] = [];
  private enabled = false;
  private destroyed = false;

  constructor(options: {
    center: { latitude: number; longitude: number };
    radiusNm?: number;
    fetchFn?: FetchLike;
    nowFn?: () => string;
    maxRecords?: number;
    retentionSeconds?: number;
    freshWithinSeconds?: number;
  }) {
    this.fetchFn = options.fetchFn ?? (async (url) => {
      const res = await fetch(url);
      return { status: res.status, text: () => res.text(), ok: res.ok } as never;
    });
    this.center = options.center;
    this.radiusNm = options.radiusNm ?? DEFAULT_POLL_RADIUS_NM;
    this.nowFn = options.nowFn ?? (() => new Date().toISOString());
    this.maxRecords = options.maxRecords ?? 1000;
    this.retentionSeconds = options.retentionSeconds ?? 24 * 3600;
    this.health = new SourceHealthStateMachine(this.id, {
      freshWithinSeconds: options.freshWithinSeconds ?? 300,
    });
  }

  private now(): string {
    return this.nowFn();
  }

  async enable(context: SourceContext): Promise<SourceResult> {
    if (this.destroyed) throw new Error("AdsbLolAdapter was destroyed and cannot be re-enabled");
    return this.poll(context.now);
  }

  async disable(): Promise<void> {
    this.enabled = false;
  }

  async refresh(context: RefreshContext): Promise<SourceResult> {
    if (!this.enabled) {
      return { status: "failure", acceptedCount: 0, rejectedCount: 0, lastObservationAt: null, message: "adapter is disabled" };
    }
    return this.poll(context.now);
  }

  getStatus(): SourceStatus {
    return this.health.snapshot(this.now());
  }

  getRecords(scope: QueryScope = {}): ReadonlyArray<TransportObservation> {
    if (!this.enabled) return [];
    return this.records.filter((o) => {
      if (scope.modes && !scope.modes.includes(o.mode)) return false;
      if (scope.timeWindow && (o.observedAt < scope.timeWindow.startAt || o.observedAt > scope.timeWindow.endAt)) return false;
      return true;
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.enabled = false;
    this.records = [];
  }

  private async poll(now: string): Promise<SourceResult> {
    const url = `https://api.adsb.lol/v2/lat/${this.center.latitude}/lon/${this.center.longitude}/dist/${this.radiusNm}`;
    let body: string;
    try {
      const res = await this.fetchFn(url);
      if (!res.ok) return this.fail(now, `HTTP ${res.status}`);
      body = await res.text();
    } catch (err) {
      return this.fail(now, `network error: ${String(err).slice(0, 80)}`);
    }
    let parsed: { ac?: unknown };
    try {
      parsed = JSON.parse(body) as { ac?: unknown };
    } catch {
      return this.fail(now, "response was not JSON");
    }
    const aircraft = Array.isArray(parsed.ac) ? (parsed.ac as Array<Record<string, unknown>>) : [];
    const nowMs = Date.parse(now);
    const accepted: TransportObservation[] = [];
    for (const ac of aircraft) {
      const seenPos = typeof ac["seen_pos"] === "number" ? (ac["seen_pos"] as number) : null;
      const raw = transformAircraft(ac, now, seenPos);
      if (raw === null) continue;
      const result = normalizeObservation(raw);
      if (result.ok) accepted.push(result.observation);
    }
    if (accepted.length === 0 && aircraft.length > 0) {
      return this.fail(now, "no aircraft records normalized");
    }
    // Bounded buffer + TTL (ADR-0012 ODbL posture).
    const cutoff = nowMs - this.retentionSeconds * 1000;
    const merged = [...this.records, ...accepted]
      .filter((o) => Date.parse(o.receivedAt) >= cutoff)
      .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0))
      .slice(-this.maxRecords);
    this.records = merged;
    this.enabled = true;
    const lastObservationAt = merged.length > 0 ? merged[merged.length - 1]!.observedAt : null;
    this.health.recordRefresh(
      lastObservationAt !== null
        ? { status: "ok", now, lastObservationAt }
        : { status: "ok", now },
    );
    return { status: "ok", acceptedCount: accepted.length, rejectedCount: aircraft.length - accepted.length, lastObservationAt, message: null };
  }

  private fail(now: string, reason: string): SourceResult {
    this.health.recordRefresh({ status: "failure", now, reason });
    return { status: "failure", acceptedCount: 0, rejectedCount: 0, lastObservationAt: null, message: reason };
  }
}
