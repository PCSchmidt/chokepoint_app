/**
 * Canonical observation model (CHOKEPOINT-PLAN.md §5.2) with normalization,
 * validation, deduplication, ordering, and entity identity rules.
 *
 * Invariants (§3.3, tested in tests/unit):
 *  - Provider timestamps are never replaced with request receipt time.
 *  - Invalid coordinates are rejected, never clamped.
 *  - Duplicate records deduplicate deterministically.
 *  - Ordering by observedAt is a stable, testable property.
 *  - Entity identity is stable across records and sessions.
 */

export type TransportMode = "sea" | "air" | "land" | "rail";

export type EntityType =
  | "cargo_vessel"
  | "tanker"
  | "bulk_carrier"
  | "aircraft"
  | "vehicle"
  | "unknown";

/**
 * Per-provider source health used inside TransportObservation.quality (§5.2 uses
 * lowercase states). These correspond to the §3.1 health states FRESH / STALE /
 * DEGRADED / UNAVAILABLE; UNKNOWN health is represented by the truth state, not
 * a source state, so it is deliberately absent here.
 */
export type SourceQualityState = "fresh" | "stale" | "degraded" | "unavailable";

export interface TransportObservation {
  observationId: string;
  entityId: string;
  mode: TransportMode;
  entityType: EntityType;
  position: {
    latitude: number;
    longitude: number;
    altitudeMeters?: number;
  };
  kinematics: {
    speedKnots?: number;
    speedKph?: number;
    headingDegrees?: number;
  };
  observedAt: string;
  receivedAt: string;
  source: {
    providerId: string;
    endpointId: string;
    recordRef?: string;
    licenseId: string;
  };
  quality: {
    sourceState: SourceQualityState;
    positionAccuracy?: "exact" | "approximate" | "unknown";
    classification: "confirmed" | "inferred" | "unknown";
  };
}

/** Loose input shape accepted from a provider payload or fixture JSON. */
export type RawObservation = Record<string, unknown>;

export type NormalizationResult =
  | { ok: true; observation: TransportObservation }
  | { ok: false; reason: string; observationId?: string | undefined };

const MODES: readonly TransportMode[] = ["sea", "air", "land", "rail"];
const ENTITY_TYPES: readonly EntityType[] = [
  "cargo_vessel",
  "tanker",
  "bulk_carrier",
  "aircraft",
  "vehicle",
  "unknown",
];
const SOURCE_STATES: readonly SourceQualityState[] = ["fresh", "stale", "degraded", "unavailable"];
const POSITION_ACCURACIES = ["exact", "approximate", "unknown"] as const;
const CLASSIFICATIONS = ["confirmed", "inferred", "unknown"] as const;

export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isOptionalFiniteNumber(v: unknown): boolean {
  return v === undefined || isFiniteNumber(v);
}

function isIsoTimestamp(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  const t = Date.parse(v);
  return !Number.isNaN(t);
}

/**
 * Validate coordinates. Rejects out-of-range and non-finite values.
 * Coordinates are never clamped or "corrected" silently (§3.3).
 */
export function isValidLatitude(lat: unknown): lat is number {
  return isFiniteNumber(lat) && lat >= MIN_LATITUDE && lat <= MAX_LATITUDE;
}

export function isValidLongitude(lon: unknown): lon is number {
  return isFiniteNumber(lon) && lon >= MIN_LONGITUDE && lon <= MAX_LONGITUDE;
}

/**
 * Stable entity identity: the same physical entity observed repeatedly must
 * resolve to the same entityId. The canonical key is provider-scoped, so ids
 * from different providers cannot collide, and normalization of the reference
 * (trim + case folding) makes identity robust to upstream formatting changes.
 */
export function entityKey(providerId: string, providerEntityRef: string): string {
  const p = providerId.trim().toLowerCase();
  const r = providerEntityRef.trim().toLowerCase();
  if (p.length === 0 || r.length === 0) {
    throw new Error("entityKey requires a non-empty providerId and providerEntityRef");
  }
  return `${p}:${r}`;
}

/**
 * Normalize and validate one raw record into the canonical schema.
 * Returns a discriminated result; rejected records carry a reason and never
 * reach analytics (Phase 1 exit criterion, §17).
 */
export function normalizeObservation(input: unknown): NormalizationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "record must be a JSON object" };
  }
  const raw = input as RawObservation;
  const observationId = typeof raw["observationId"] === "string" ? raw["observationId"] : undefined;

  const fail = (reason: string): NormalizationResult =>
    observationId === undefined ? { ok: false, reason } : { ok: false, reason, observationId };

  if (typeof raw["observationId"] !== "string" || raw["observationId"].length === 0) {
    return fail("missing or empty observationId");
  }
  if (typeof raw["entityId"] !== "string" || raw["entityId"].length === 0) {
    return fail("missing or empty entityId");
  }
  if (!MODES.includes(raw["mode"] as TransportMode)) {
    return fail(`invalid mode: ${String(raw["mode"])}`);
  }
  if (!ENTITY_TYPES.includes(raw["entityType"] as EntityType)) {
    return fail(`invalid entityType: ${String(raw["entityType"])}`);
  }

  const position = raw["position"] as Record<string, unknown> | undefined;
  if (!position || typeof position !== "object") return fail("missing position");
  if (!isValidLatitude(position["latitude"])) return fail("invalid latitude (must be finite and within [-90, 90])");
  if (!isValidLongitude(position["longitude"])) return fail("invalid longitude (must be finite and within [-180, 180])");
  if (!isOptionalFiniteNumber(position["altitudeMeters"])) return fail("invalid altitudeMeters");

  const kinematics = raw["kinematics"] as Record<string, unknown> | undefined;
  if (!kinematics || typeof kinematics !== "object") return fail("missing kinematics");
  if (!isOptionalFiniteNumber(kinematics["speedKnots"])) return fail("invalid speedKnots");
  if (!isOptionalFiniteNumber(kinematics["speedKph"])) return fail("invalid speedKph");
  if (!isOptionalFiniteNumber(kinematics["headingDegrees"])) return fail("invalid headingDegrees");
  const heading = kinematics["headingDegrees"];
  if (isFiniteNumber(heading) && (heading < 0 || heading >= 360)) {
    return fail("headingDegrees must be within [0, 360)");
  }

  if (!isIsoTimestamp(raw["observedAt"])) return fail("missing or invalid observedAt (ISO 8601 required)");
  if (!isIsoTimestamp(raw["receivedAt"])) return fail("missing or invalid receivedAt (ISO 8601 required)");

  const source = raw["source"] as Record<string, unknown> | undefined;
  if (!source || typeof source !== "object") return fail("missing source block");
  if (typeof source["providerId"] !== "string" || source["providerId"].length === 0) {
    return fail("missing source.providerId");
  }
  if (typeof source["endpointId"] !== "string" || source["endpointId"].length === 0) {
    return fail("missing source.endpointId");
  }
  if (typeof source["licenseId"] !== "string" || source["licenseId"].length === 0) {
    return fail("missing source.licenseId");
  }
  const recordRef = source["recordRef"];
  if (recordRef !== undefined && typeof recordRef !== "string") {
    return fail("invalid source.recordRef");
  }

  const quality = raw["quality"] as Record<string, unknown> | undefined;
  if (!quality || typeof quality !== "object") return fail("missing quality block");
  if (!SOURCE_STATES.includes(quality["sourceState"] as SourceQualityState)) {
    return fail(`invalid quality.sourceState: ${String(quality["sourceState"])}`);
  }
  const positionAccuracy = quality["positionAccuracy"];
  if (positionAccuracy !== undefined && !(POSITION_ACCURACIES as readonly string[]).includes(positionAccuracy as string)) {
    return fail(`invalid quality.positionAccuracy: ${String(positionAccuracy)}`);
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(quality["classification"] as string)) {
    return fail(`invalid quality.classification: ${String(quality["classification"])}`);
  }

  // Build with exactOptionalPropertyTypes compliance: only set optional
  // properties when actually present in the source record.
  const altitude = position["altitudeMeters"] as number | undefined;
  const speedKnots = kinematics["speedKnots"] as number | undefined;
  const speedKph = kinematics["speedKph"] as number | undefined;
  const headingDeg = kinematics["headingDegrees"] as number | undefined;
  const acc = positionAccuracy as TransportObservation["quality"]["positionAccuracy"];

  const observation: TransportObservation = {
    observationId: raw["observationId"] as string,
    entityId: raw["entityId"] as string,
    mode: raw["mode"] as TransportMode,
    entityType: raw["entityType"] as EntityType,
    position: {
      latitude: position["latitude"] as number,
      longitude: position["longitude"] as number,
      ...(altitude !== undefined ? { altitudeMeters: altitude } : {}),
    },
    kinematics: {
      ...(speedKnots !== undefined ? { speedKnots } : {}),
      ...(speedKph !== undefined ? { speedKph } : {}),
      ...(headingDeg !== undefined ? { headingDegrees: headingDeg } : {}),
    },
    observedAt: raw["observedAt"] as string,
    receivedAt: raw["receivedAt"] as string,
    source: {
      providerId: source["providerId"] as string,
      endpointId: source["endpointId"] as string,
      ...(recordRef !== undefined ? { recordRef: recordRef as string } : {}),
      licenseId: source["licenseId"] as string,
    },
    quality: {
      sourceState: quality["sourceState"] as SourceQualityState,
      ...(acc !== undefined ? { positionAccuracy: acc } : {}),
      classification: quality["classification"] as TransportObservation["quality"]["classification"],
    },
  };

  return { ok: true, observation };
}

/** Deterministic sort key: observedAt, then entityId, then observationId. */
export function compareByTime(a: TransportObservation, b: TransportObservation): number {
  if (a.observedAt !== b.observedAt) return a.observedAt < b.observedAt ? -1 : 1;
  if (a.entityId !== b.entityId) return a.entityId < b.entityId ? -1 : 1;
  return a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;
}

/**
 * Total deterministic order over observations (handles out-of-order arrival).
 */
export function sortObservations(observations: readonly TransportObservation[]): TransportObservation[] {
  return [...observations].sort(compareByTime);
}

/**
 * Deterministic duplicate key. Prefer the provider recordRef when present;
 * fall back to entity + timestamp + position so records without a provider ref
 * still deduplicate (same entity, same second, same place = same observation).
 */
export function duplicateKey(o: TransportObservation): string {
  if (o.source.recordRef !== undefined) {
    return `ref:${o.source.providerId}:${o.source.recordRef}`;
  }
  return [
    "pos",
    o.entityId,
    o.observedAt,
    o.position.latitude.toFixed(5),
    o.position.longitude.toFixed(5),
  ].join(":");
}

/**
 * Remove duplicate observations. Ties break on the canonical sort order so the
 * surviving record is deterministic regardless of input order.
 */
export function dedupeObservations(
  observations: readonly TransportObservation[]
): { unique: TransportObservation[]; duplicatesRemoved: number } {
  const sorted = sortObservations(observations);
  const seen = new Map<string, TransportObservation>();
  for (const o of sorted) {
    const key = duplicateKey(o);
    const existing = seen.get(key);
    // First occurrence in canonical order wins; later equal keys are duplicates.
    if (existing === undefined) seen.set(key, o);
  }
  const unique = sortObservations([...seen.values()]);
  return { unique, duplicatesRemoved: observations.length - unique.length };
}
