/**
 * Facility-level metrics (CHOKEPOINT-PLAN.md §3.1–3.3, §5.1, §5.5; ADR-0015).
 *
 * A FacilityMetric is an OBSERVED reading at a FIXED facility (border
 * crossing, rail crossing) — a wait-time number, lanes-open count, or
 * operational status — never a moving entity. It deliberately does NOT fit
 * TransportObservation and must never be merged into entity totals, cohorts,
 * or geofence counts (ADR-0015, option b; option c — synthetic entities —
 * rejected outright).
 *
 * Same trust contracts as every record in this data layer (§3.1–3.3):
 *  - truthState OBSERVED (the facility value is provider-reported), never
 *    mixed into vessel/aircraft totals;
 *  - invalid values are REJECTED with reasons, never clamped (§3.3);
 *  - missing is UNKNOWN, never zero;
 *  - deterministic dedupe and total ordering (§12.1);
 *  - per-provider provenance (§3.2).
 */

import type { TransportMode, SourceQualityState } from "./observation";

/** Kinds of fixed facility the multimodal layers observe. */
export type FacilityType =
  | "border-crossing"
  | "rail-crossing"
  | "airport-cargo"
  | "port-terminal";

/** Which lane group a measurement describes (CBP publishes these groups). */
export type FacilityLaneGroup =
  | "commercial_vehicle"
  | "passenger_vehicle"
  | "pedestrian"
  | "fast"
  | "all";

/** The measured quantity. v1 ships border wait times; the vocabulary is open. */
export type FacilityMetricType =
  | "wait_minutes"
  | "lanes_open"
  | "lanes_maximum"
  | "operational_status";

/** A single measured value within a facility reading. */
export interface FacilityMeasurement {
  laneGroup: FacilityLaneGroup;
  metric: FacilityMetricType;
  /** The reported value (minutes for wait_minutes, integer for lanes_open). */
  value: number | null;
  unit: "minutes" | "lanes" | "status";
  /** Status words come verbatim from the provider ("delay", "N/A", ...). */
  statusLabel?: string | undefined;
}

/**
 * A normalized, validated facility reading. One record = one facility at one
 * observed moment (dedupe key: facilityId + observedAt + laneGroup).
 */
export interface FacilityMetric {
  metricId: string;
  facilityId: string;
  facilityType: FacilityType;
  displayName: string;
  mode: TransportMode;
  /** Facility coordinates (OBSERVED metadata about the facility, §3.2). */
  location: { latitude: number; longitude: number } | null;
  /** The provider's own reading timestamp (e.g. CBP lane update time). */
  observedAt: string;
  /** When Chokepoint ingested the reading. */
  receivedAt: string;
  measurements: FacilityMeasurement[];
  /** Verbatim provider update label (e.g. "At 7:00 am EDT") — shown, not parsed. */
  providerUpdateLabel: string | null;
  portStatus: string | null;
  constructionNotice: string | null;
  source: {
    providerId: string;
    endpointId: string;
    recordRef?: string;
    licenseId: string;
  };
  quality: {
    sourceState: SourceQualityState;
  };
}

/** Loose input shape accepted from a provider payload or fixture JSON. */
export type RawFacilityMetric = Record<string, unknown>;

export type FacilityNormalizationResult =
  | { ok: true; metric: FacilityMetric }
  | { ok: false; reason: string; metricId?: string };

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

function isValidLatitude(v: number): boolean {
  return Number.isFinite(v) && v >= MIN_LATITUDE && v <= MAX_LATITUDE;
}

function isValidLongitude(v: number): boolean {
  return Number.isFinite(v) && v >= MIN_LONGITUDE && v <= MAX_LONGITUDE;
}

function isIsoTimestamp(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

const LANE_GROUPS: readonly string[] = [
  "commercial_vehicle",
  "passenger_vehicle",
  "pedestrian",
  "fast",
  // Real CBP payloads include these program lanes (VERIFIED 2026-09-10 sample).
  "nexus_sentri",
  "ready",
];

const METRIC_TYPES: readonly string[] = ["wait_minutes", "lanes_open", "operational_status"];

/**
 * Normalize and validate a raw facility record. Invalid input is REJECTED
 * with a reason — never clamped, never defaulted to zero (§3.3). Missing
 * lane data is omitted, not invented.
 */
export function normalizeFacilityMetric(input: unknown): FacilityNormalizationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "record must be a JSON object" };
  }
  const raw = input as RawFacilityMetric;
  const metricId = typeof raw["metricId"] === "string" ? raw["metricId"] : undefined;

  const fail = (reason: string): FacilityNormalizationResult =>
    metricId === undefined ? { ok: false, reason } : { ok: false, reason, metricId };

  if (typeof raw["metricId"] !== "string" || raw["metricId"].length === 0) {
    return fail("metricId must be a non-empty string");
  }
  if (typeof raw["facilityId"] !== "string" || raw["facilityId"].length === 0) {
    return fail("facilityId must be a non-empty string");
  }
  if (typeof raw["facilityType"] !== "string" || raw["facilityType"].length === 0) {
    return fail("facilityType must be a non-empty string");
  }
  if (typeof raw["displayName"] !== "string" || raw["displayName"].length === 0) {
    return fail("displayName must be a non-empty string");
  }
  const mode = raw["mode"];
  if (mode !== "land" && mode !== "rail" && mode !== "air") {
    return fail(`unsupported facility mode: ${String(mode)}`);
  }
  if (!isIsoTimestamp(raw["observedAt"])) {
    return fail("observedAt must be an ISO timestamp");
  }
  if (!isIsoTimestamp(raw["receivedAt"])) {
    return fail("receivedAt must be an ISO timestamp");
  }
  // obs <= received is the only ordering rule; equality is fine (instant feeds).
  if (Date.parse(raw["observedAt"]) > Date.parse(raw["receivedAt"])) {
    return fail("observedAt cannot be after receivedAt");
  }

  let location: { latitude: number; longitude: number } | null = null;
  const rawLoc = raw["location"];
  if (rawLoc !== null && rawLoc !== undefined) {
    if (typeof rawLoc !== "object") return fail("location must be an object or null");
    const loc = rawLoc as RawFacilityMetric;
    const lat = loc["latitude"];
    const lon = loc["longitude"];
    if (typeof lat !== "number" || !isValidLatitude(lat)) {
      return fail("location.latitude must be a valid latitude — never clamped");
    }
    if (typeof lon !== "number" || !isValidLongitude(lon)) {
      return fail("location.longitude must be a valid longitude — never clamped");
    }
    location = { latitude: lat, longitude: lon };
  }

  const rawMeasurements = raw["measurements"];
  if (!Array.isArray(rawMeasurements) || rawMeasurements.length === 0) {
    return fail("measurements must be a non-empty array");
  }
  const measurements: FacilityMeasurement[] = [];
  for (const rm of rawMeasurements) {
    if (typeof rm !== "object" || rm === null) return fail("each measurement must be an object");
    const m = rm as RawFacilityMetric;
    const laneGroup = m["laneGroup"];
    if (typeof laneGroup !== "string" || !LANE_GROUPS.includes(laneGroup)) {
      return fail(`unsupported laneGroup: ${String(m["laneGroup"])}`);
    }
    const metric = m["metric"];
    if (typeof metric !== "string" || !METRIC_TYPES.includes(metric)) {
      return fail(`unsupported facility metric type: ${String(m["metric"])}`);
    }
    const value = m["value"];
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
      return fail(`measurement value must be a finite number or null — got ${String(value)}`);
    }
    if (metric === "wait_minutes" && typeof value === "number" && value < 0) {
      return fail("wait_minutes cannot be negative — never clamped");
    }
    if (metric === "lanes_open" && typeof value === "number" && !Number.isInteger(value)) {
      return fail("lanes_open must be an integer");
    }
    measurements.push({
      laneGroup: laneGroup as FacilityLaneGroup,
      metric: metric as FacilityMetricType,
      value: value as number | null,
      unit: metric === "wait_minutes" ? "minutes" : metric === "lanes_open" ? "lanes" : "status",
      ...(typeof m["statusLabel"] === "string" ? { statusLabel: m["statusLabel"] as string } : {}),
    });
  }

  const source = raw["source"];
  if (typeof source !== "object" || source === null) return fail("source must be an object");
  const src = source as RawFacilityMetric;
  if (typeof src["providerId"] !== "string" || typeof src["endpointId"] !== "string" || typeof src["licenseId"] !== "string") {
    return fail("source.providerId/endpointId/licenseId are required strings");
  }

  const qualityState = raw["quality"] !== null && typeof raw["quality"] === "object"
    ? (raw["quality"] as RawFacilityMetric)["sourceState"]
    : undefined;
  const sourceState: SourceQualityState =
    qualityState === "fresh" || qualityState === "stale" || qualityState === "degraded" || qualityState === "unavailable"
      ? qualityState
      : "unavailable";

  return {
    ok: true,
    metric: {
      metricId: raw["metricId"],
      facilityId: raw["facilityId"],
      facilityType: raw["facilityType"] as FacilityType,
      displayName: raw["displayName"],
      mode: mode,
      location,
      observedAt: raw["observedAt"],
      receivedAt: raw["receivedAt"],
      measurements,
      providerUpdateLabel: typeof raw["providerUpdateLabel"] === "string" ? raw["providerUpdateLabel"] : null,
      portStatus: typeof raw["portStatus"] === "string" ? raw["portStatus"] : null,
      constructionNotice: typeof raw["constructionNotice"] === "string" ? raw["constructionNotice"] : null,
      source: {
        providerId: src["providerId"] as string,
        endpointId: src["endpointId"] as string,
        ...(typeof src["recordRef"] === "string" ? { recordRef: src["recordRef"] as string } : {}),
        licenseId: src["licenseId"] as string,
      },
      quality: { sourceState: sourceState as SourceQualityState },
    },
  };
}

/** Deterministic dedupe key: facility + reading time + lane/metric set. */
export function facilityDuplicateKey(m: FacilityMetric): string {
  const laneKeys = m.measurements
    .map((x) => `${x.laneGroup}:${x.metric}`)
    .sort()
    .join("|");
  return `${m.facilityId}|${m.observedAt}|${laneKeys}`;
}

/** Total ordering: observedAt ASC, then metricId ASC (stable, §12.1). */
export function compareFacilityMetrics(a: FacilityMetric, b: FacilityMetric): number {
  const t = Date.parse(a.observedAt) - Date.parse(b.observedAt);
  if (t !== 0) return t;
  return a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0;
}

export function sortFacilityMetrics(metrics: readonly FacilityMetric[]): FacilityMetric[] {
  return [...metrics].sort(compareFacilityMetrics);
}

/**
 * Dedupe deterministically: when two records share a dedupe key, the LATEST
 * receivedAt wins; ties break by metricId so input order never matters (§12.1).
 */
export function dedupeFacilityMetrics(metrics: readonly FacilityMetric[]): FacilityMetric[] {
  const byKey = new Map<string, FacilityMetric>();
  for (const m of metrics) {
    const key = facilityDuplicateKey(m);
    const existing = byKey.get(key);
    if (
      !existing ||
      Date.parse(m.receivedAt) > Date.parse(existing.receivedAt) ||
      (Date.parse(m.receivedAt) === Date.parse(existing.receivedAt) && m.metricId > existing.metricId)
    ) {
      byKey.set(key, m);
    }
  }
  return sortFacilityMetrics([...byKey.values()]);
}

/** Stable facility identity, provider-scoped (§3.2). */
export function facilityKey(providerId: string, externalFacilityId: string): string {
  return `${providerId}:${externalFacilityId}`;
}
