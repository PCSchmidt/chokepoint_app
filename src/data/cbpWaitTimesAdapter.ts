/**
 * CBP Border Wait Times adapter (ADR-0013; §5.1 SourceAdapter contract;
 * CHOKEPOINT-PLAN.md §14.1 key hygiene).
 *
 * Polls CBP's own keyless endpoint (`https://bwt.cbp.gov/api/waittimes`,
 * VERIFIED live 2026-09-10, 85 US crossings) and emits OBSERVED
 * FacilityMetric records (ADR-0015) — facility-level readings, NEVER
 * TransportObservations.
 *
 * Key hygiene (§14.1): the endpoint requires NO key and this adapter reads no
 * credentials. Transport is INJECTED: all tests use a fake fetch; no test
 * touches the network (CI stays keyless and offline).
 *
 * Honest semantics (§3.1/§3.3):
 *  - lane readings are OBSERVED with the provider's own update label kept
 *    verbatim; "Update Pending" / "N/A" lanes are omitted (missing, not zero);
 *  - negative or non-numeric delays are rejected with reasons, never clamped;
 *  - health uses the standard state machine with a GENEROUS freshness
 *    threshold (per-port updates are periodic; hours-stale at quiet crossings
 *    is normal operation, not failure — ADR-0013).
 */

import {
  normalizeFacilityMetric,
  type FacilityMetric,
  type RawFacilityMetric,
} from "./facilityMetric";
import { SourceHealthStateMachine } from "./sourceHealth";
import type {
  RefreshContext,
  SourceContext,
  SourceResult,
  SourceStatus,
  LicenseMetadata,
  SourceCapabilities,
} from "./sourceAdapter";

export const CBP_ADAPTER_ID = "cbp-bwt";
export const CBP_ENDPOINT = "https://bwt.cbp.gov/api/waittimes";
/** Conservative default poll cadence: CBP updates per-port periodically. */
export const DEFAULT_POLL_SECONDS = 600;
/** Lane updates can legitimately be hours old at quiet crossings (ADR-0013). */
export const DEFAULT_FRESH_WITHIN_SECONDS = 6 * 3600;

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface CbpWaitTimesAdapterOptions {
  fetchFn?: FetchLike | undefined;
  /** Poll interval hint for callers driving refresh (the adapter itself never sets timers). */
  pollSeconds?: number;
  freshWithinSeconds?: number;
  /** Restrict to specific CBP port numbers (default: El Paso cluster, per ADR-0013 scope). */
  portNumbers?: readonly string[] | undefined;
  nowFn?: () => string;
  maxRecords?: number;
}

/** Raw lane shape from the CBP payload (VERIFIED 2026-09-10). */
interface RawLane {
  update_time?: string;
  operational_status?: string;
  delay_minutes?: string;
  lanes_open?: string;
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Transform one CBP crossing record into a raw FacilityMetric. Returns null
 * when the crossing carries no usable readings (all lanes pending/N/A).
 */
export function transformCbpCrossing(
  crossing: Record<string, unknown>,
  receivedAt: string,
): { ok: true; raw: RawFacilityMetric } | { ok: false; reason: string } {
  const portNumber = typeof crossing["port_number"] === "string" ? crossing["port_number"] : null;
  const portName = typeof crossing["port_name"] === "string" ? crossing["port_name"] : null;
  const crossingName = typeof crossing["crossing_name"] === "string" ? crossing["crossing_name"] : null;
  const date = typeof crossing["date"] === "string" ? crossing["date"] : null;
  const time = typeof crossing["time"] === "string" ? crossing["time"] : null;
  if (!portNumber || !portName || !date || !time) {
    return { ok: false, reason: "crossing missing port_number/port_name/date/time" };
  }
  const [m, d, y] = date.split("/");
  if (!m || !d || !y) return { ok: false, reason: `unparseable CBP date: ${date}` };
  const observedAt = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${time}Z`;
  if (Number.isNaN(Date.parse(observedAt))) {
    return { ok: false, reason: `unparseable CBP observation time: ${date} ${time}` };
  }

  const resolvedCrossingName = crossingName && crossingName.length > 0 ? crossingName : portName;
  const facilityId = `cbp:${portNumber}:${resolvedCrossingName.split(" ")[0]!.toLowerCase()}`;

  const measurements: RawFacilityMetric[] = [];
  const containers: ReadonlyArray<[string, unknown]> = [
    ["commercial_vehicle_lanes", crossing["commercial_vehicle_lanes"]],
    ["passenger_vehicle_lanes", crossing["passenger_vehicle_lanes"]],
    ["pedestrian_lanes", crossing["pedestrian_lanes"]],
  ];
  for (const [containerKey, container] of containers) {
    if (typeof container !== "object" || container === null) continue;
    for (const [laneKey, lane] of Object.entries(container as Record<string, unknown>)) {
      if (typeof lane !== "object" || lane === null) continue;
      const l = lane as RawLane;
      const status = (l["operational_status"] ?? "").toString().trim();
      if (!status || status === "N/A" || status === "Update Pending") continue; // missing, not zero
      const delay = toIntOrNull(l["delay_minutes"]);
      const lanes = toIntOrNull(l["lanes_open"]);
      const laneGroup =
        containerKey === "pedestrian_lanes"
          ? "pedestrian"
          : laneKey === "FAST_lanes"
            ? "fast"
            : laneKey === "ready_lanes"
              ? "ready"
              : laneKey === "NEXUS_SENTRI_lanes"
                ? "nexus_sentri"
                : containerKey === "commercial_vehicle_lanes"
                  ? "commercial_vehicle"
                  : "passenger_vehicle";
      if (delay !== null) {
        measurements.push({ laneGroup, metric: "wait_minutes", value: delay, statusLabel: status });
      }
      if (lanes !== null) {
        measurements.push({ laneGroup, metric: "lanes_open", value: lanes, statusLabel: status });
      }
      if (delay !== null && lanes !== null) {
        measurements.push({
          laneGroup,
          metric: "operational_status",
          value: null,
          statusLabel: status,
        });
      }
      if (!laneGroup) return { ok: false, reason: `unmappable lane group: ${containerKey}/${laneKey}` };
      if (laneKey === "standard_lanes" && !laneGroup) return { ok: false, reason: "standard lanes must map" };
    }
  }
  if (measurements.length === 0) {
    return { ok: false, reason: `no usable lane readings for ${facilityId} (all pending/empty)` };
  }
  // providerUpdateLabel: first non-empty lane update_time (kept verbatim, ADR-0013)
  let providerUpdateLabel: string | null = null;
  outer: for (const [, container] of containers) {
    if (typeof container !== "object" || container === null) continue;
    for (const lane of Object.values(container as Record<string, unknown>)) {
      if (typeof lane !== "object" || lane === null) continue;
      const label = (lane as RawLane)["update_time"];
      if (typeof label === "string" && label.trim().length > 0) {
        providerUpdateLabel = label;
        break outer;
      }
    }
  }
  return {
    ok: true,
    raw: {
      metricId: `${facilityId}:${observedAt}`,
      facilityId,
      facilityType: "border-crossing",
      displayName: `${portName} - ${resolvedCrossingName}`,
      mode: "land",
      location: null, // CBP does not publish facility coordinates in this payload
      observedAt,
      receivedAt,
      measurements,
      providerUpdateLabel,
      portStatus: typeof crossing["port_status"] === "string" ? (crossing["port_status"] as string) : null,
      constructionNotice: typeof crossing["construction_notice"] === "string" ? (crossing["construction_notice"] as string) : null,
      source: {
        providerId: CBP_ADAPTER_ID,
        endpointId: CBP_ENDPOINT_ID,
        recordRef: `port_number=${String(portNumber)}`,
        licenseId: "public-domain-usg",
      },
      quality: { sourceState: "fresh" },
    },
  };
}

const CBP_ENDPOINT_ID = "bwt.cbp.gov/api/waittimes";

export class CbpWaitTimesAdapter {
  readonly id = CBP_ADAPTER_ID;
  readonly label = "CBP Border Wait Times (bwt.cbp.gov, keyless, OBSERVED facility metrics)";
  readonly license: LicenseMetadata = {
    licenseId: "public-domain-usg",
    termsUrl: null,
    commercialUse: "permitted",
    attributionText: "Border wait times: U.S. Customs and Border Protection",
    rawStorageAllowed: true,
    derivedStorageAllowed: true,
  };
  readonly capabilities: SourceCapabilities = {
    modes: ["land"],
    entityTypes: [],
    providesPositions: false,
    providesClassification: false,
    maxRecordsPerRefresh: null,
    historicalRetention: "none",
  };

  private readonly fetchFn: FetchLike;
  private readonly endpoint: string;
  private readonly portNumbers: ReadonlySet<string> | null;
  private readonly nowFn: () => string;
  private health: SourceHealthStateMachine;
  private records: FacilityMetric[] = [];
  private enabled = false;
  private destroyed = false;

  constructor(options: CbpWaitTimesAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? (async (url) => {
      const res = await fetch(url);
      return { status: res.status, text: () => res.text(), ok: res.ok } as never;
    });
    this.endpoint = "https://bwt.cbp.gov/api/waittimes";
    this.portNumbers = options.portNumbers ? new Set(options.portNumbers) : null;
    this.nowFn = options.nowFn ?? (() => new Date().toISOString());
    this.health = new SourceHealthStateMachine(this.id, {
      freshWithinSeconds: options.freshWithinSeconds ?? DEFAULT_FRESH_WITHIN_SECONDS,
    });
  }

  private now(): string {
    return this.nowFn ? this.nowFn() : new Date().toISOString();
  }

  async enable(context: SourceContext): Promise<SourceResult> {
    if (this.destroyed) throw new Error("CbpWaitTimesAdapter was destroyed and cannot be re-enabled");
    return this.poll(context.now);
  }

  async disable(): Promise<void> {
    this.enabled = false;
    this.records = [];
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

  /**
   * Latest reading per facility (deterministic: newest observedAt per
   * facilityId). The CBP endpoint reports the full crossing set each poll;
   * the adapter keeps the newest reading per crossing.
   */
  getFacilityMetrics(): ReadonlyArray<FacilityMetric> {
    if (!this.enabled) return [];
    const latest = new Map<string, FacilityMetric>();
    for (const m of this.records) {
      const existing = latest.get(m.facilityId);
      if (!existing || m.observedAt > existing.observedAt) latest.set(m.facilityId, m);
    }
    return [...latest.values()];
  }

  destroy(): void {
    this.destroyed = true;
    this.enabled = false;
    this.records = [];
  }

  private async poll(now: string): Promise<SourceResult> {
    let body: string;
    try {
      const res = await this.fetchFn(this.endpoint);
      if (!res.ok) {
        this.enabled = true;
        return this.healthFailure(now, `HTTP ${res.status}`);
      }
      body = await res.text();
    } catch (err) {
      this.enabled = true;
      return this.healthFailure(now, `network error: ${String(err).slice(0, 80)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return this.healthFailure(now, "response was not JSON");
    }
    if (!Array.isArray(parsed)) {
      return this.healthFailure(now, "payload is not an array of crossings");
    }
    const raws: FacilityMetric[] = [];
    let rejectedCount = 0;
    for (const crossing of parsed as Array<Record<string, unknown>>) {
      const portNumber = typeof crossing["port_number"] === "string" ? crossing["port_number"] : null;
      if (this.portNumbers && (!portNumber || !this.portNumbers.has(portNumber))) continue;
      const t = transformCbpCrossing(crossing, now);
      if (!t.ok) {
        rejectedCount += 1;
        continue;
      }
      const normalized = normalizeFacilityMetric(t.raw);
      if (normalized.ok) raws.push(normalized.metric);
      else rejectedCount += 1;
    }
    if (raws.length === 0) {
      this.enabled = true;
      return this.healthFailure(now, "no usable crossings in payload");
    }
    this.records = raws;
    this.enabled = true;
    // Facility readings are timestamped by CBP itself; age vs `now` decides
    // FRESH vs STALE (§3.1) — hours-stale is normal per ADR-0013.
    const lastObservationAt = raws.reduce((a: FacilityMetric, b: FacilityMetric) => (a.observedAt > b.observedAt ? a : b)).observedAt;
    this.health.recordRefresh(
      rejectedCount > 0
        ? { status: "partial", now, lastObservationAt, rejectedCount, reason: "some crossings failed normalization" }
        : { status: "ok", now, lastObservationAt },
    );
    return {
      status: rejectedCount > 0 ? "partial" : "ok",
      acceptedCount: raws.length,
      rejectedCount: rejectedCount,
      lastObservationAt,
      message: null,
    };
  }

  private healthFailure(now: string, reason: string): SourceResult {
    this.health.recordRefresh({ status: "failure", now, reason });
    return { status: "failure", acceptedCount: 0, rejectedCount: 0, lastObservationAt: null, message: reason };
  }
}
