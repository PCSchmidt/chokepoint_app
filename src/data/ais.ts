/**
 * AISStream message normalization (CHOKEPOINT-PLAN.md §5.1, §5.2, §17 Phase 1
 * deliverable "AIS normalization").
 *
 * Pure, keyless, deterministic: this module converts AISStream WebSocket frames
 * into canonical TransportObservations. It never opens a connection and never
 * reads an API key — transport belongs to the future live adapter (Phase 2),
 * which will proxy server-side per ADR-0010/§14.1.
 *
 * ADR-0010 obligations honored here:
 *  - Raw frames are NEVER retained; the only persistent state is the
 *    per-entity classification cache derived from ShipStaticData.
 *  - Frames map into the §5.2 canonical schema; invalid data is rejected,
 *    never clamped or guessed (§3.3).
 *
 * Frame shape (verified against aisstream/example, 2026-09-09):
 *   { MessageType: "PositionReport",
 *     MetaData: { MMSI, ShipName, latitude, longitude, time_utc },
 *     Message: { PositionReport: { UserID, SOG, COG, Heading, Latitude, Longitude, ... },
 *                ShipStaticData: { Type, CallSign, ImoNumber, ... } } }
 *
 * AIS sentinels handled per ITU-R M.1371:
 *   SOG 102.3 = not available; Heading 511 = not available; COG 360 = not available.
 *   Unavailable fields are OMITTED (missing ≠ zero, §3.3; §7.2 missing speed
 *   is never counted as stopped).
 *
 * Classification (versioned `ais-classification-v1`): AIS ship type codes 70-79
 * map to cargo_vessel and 80-89 to tanker. Bulk carriers are NOT separable from
 * generic cargo via AIS type codes alone — they broadcast cargo codes — so they
 * are classified cargo_vessel and stay inside the freight cohort; refining that
 * would require external metadata (§2.1: "bulk carriers where source
 * classification is reliable"). Non-freight codes map to entityType "unknown"
 * with a CONFIRMED classification (visible context, never in freight totals);
 * code 0 / missing type maps to entityType "unknown" with UNKNOWN classification
 * (UNCLASSIFIED cohort, §3.3).
 */

import { entityKey, type EntityType, type TransportObservation } from "./observation";

export const AISSTREAM_PROVIDER_ID = "aisstream";
export const AISSTREAM_ENDPOINT_ID = "wss://stream.aisstream.io/v0/stream";
/**
 * ADR-0010: AISStream publishes no data-use terms; the license id records the
 * risk-accepted reality rather than implying a grant.
 */
export const AISSTREAM_LICENSE_ID = "aisstream-no-written-terms-risk-accepted";
export const AIS_CLASSIFICATION_VERSION = "ais-classification-v1";

/** ITU-R M.1371 sentinels for "not available". */
export const SOG_NOT_AVAILABLE = 102.3;
export const HEADING_NOT_AVAILABLE = 511;
export const COG_NOT_AVAILABLE = 360;

export type AisFrameClassification = "confirmed" | "unknown";

export interface AisShipTypeMapping {
  entityType: EntityType;
  classification: AisFrameClassification;
}

/**
 * Versioned AIS ship type code → entity type mapping (ITU-R M.1371, §3.3
 * rules). See module header for the bulk-carrier note.
 */
export function mapAisShipTypeCode(code: number | undefined): AisShipTypeMapping {
  if (code === undefined || code === 0) {
    return { entityType: "unknown", classification: "unknown" };
  }
  if (code >= 70 && code <= 79) return { entityType: "cargo_vessel", classification: "confirmed" };
  if (code >= 80 && code <= 89) return { entityType: "tanker", classification: "confirmed" };
  // Fishing, towing, military, passenger, WIG, HSC, tugs/pilots, "other": all
  // confirmed non-freight types — visible context only (§2.1).
  if (
    (code >= 20 && code <= 59) ||
    (code >= 60 && code <= 69) ||
    (code >= 90 && code <= 99)
  ) {
    return { entityType: "unknown", classification: "confirmed" };
  }
  // Reserved/unknown codes (1-19, 6x gaps covered above): treat as unknown.
  return { entityType: "unknown", classification: "unknown" };
}

/**
 * Parse AISStream MetaData.time_utc, e.g. "2021-11-01 05:08:39.341 +0000 UTC".
 * Also accepts plain ISO 8601. Returns the original string if parseable
 * ISO-compatible, else the normalized ISO string. Provider timestamps are
 * never replaced (§3.3).
 */
export function parseAisStreamTimeUtc(value: string): string | null {
  // The AIS-specific format is matched FIRST: V8's lenient Date.parse can
  // misinterpret the trailing "UTC" token, so explicit parsing wins.
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))? ([+-]\d{4}) UTC$/.exec(value);
  if (m) {
    const [, y, mo, d, h, mi, s, ms, offset] = m as unknown as [string, string, string, string, string, string, string, string, string, string];
    const sign = offset.startsWith("-") ? -1 : 1;
    const offSeconds = (Number(offset.slice(1, 3)) * 3600 + Number(offset.slice(3, 5)) * 60) * sign;
    const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms ? Number(ms.padEnd(3, "0")) : 0);
    return new Date(utc - offSeconds * 1000).toISOString().replace(".000Z", "Z");
  }
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString().replace(".000Z", "Z");
  return null;
}

export type AisNormalizationResult =
  | { kind: "observation"; observation: TransportObservation }
  | { kind: "classification-update"; entityId: string; entityType: EntityType; classification: AisFrameClassification }
  | { kind: "unsupported"; reason: string }
  | { kind: "invalid"; reason: string };

interface CachedClassification {
  entityType: EntityType;
  classification: AisFrameClassification;
}

/**
 * Stateful normalizer: merges the latest ShipStaticData classification into
 * subsequent PositionReports for the same MMSI (AIS sends static data only
 * every ~6 minutes; positions every few seconds). The cache holds ONLY the
 * derived classification triple — never raw frames (ADR-0010).
 */
export class AisStreamNormalizer {
  private readonly classificationCache = new Map<string, CachedClassification>();

  /** Number of entities with cached classification (diagnostics/telemetry). */
  get cachedEntityCount(): number {
    return this.classificationCache.size;
  }

  /**
   * Normalize one AISStream frame. `receivedAt` is supplied by the caller
   * (the adapter's receipt time) — the wall clock is never read here.
   * Provider timestamps are preserved as `observedAt` (§3.3).
   */
  normalize(frame: unknown, receivedAt: string): AisNormalizationResult {
    if (Number.isNaN(Date.parse(receivedAt))) {
      return { kind: "invalid", reason: "receivedAt must be a valid ISO 8601 timestamp" };
    }
    if (typeof frame !== "object" || frame === null) {
      return { kind: "invalid", reason: "frame must be a JSON object" };
    }
    const f = frame as Record<string, unknown>;
    const messageType = f["MessageType"];
    if (typeof messageType !== "string" || messageType.length === 0) {
      return { kind: "invalid", reason: "missing or empty MessageType" };
    }

    const message = f["Message"] as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") {
      return { kind: "invalid", reason: "missing Message block" };
    }
    const metaData = f["MetaData"] as Record<string, unknown> | undefined;
    if (!metaData || typeof metaData !== "object") {
      return { kind: "invalid", reason: "missing MetaData block" };
    }

    const mmsi = this.mmsiOf(metaData, message, messageType);
    if (mmsi === null) {
      return { kind: "invalid", reason: `missing MMSI/UserID for ${messageType}` };
    }
    const entityId = entityKey(AISSTREAM_PROVIDER_ID, String(mmsi));

    if (messageType === "ShipStaticData" || messageType === "StaticDataReport") {
      return this.ingestStaticData(entityId, message);
    }
    if (
      messageType === "PositionReport" ||
      messageType === "StandardClassBPositionReport" ||
      messageType === "ExtendedClassBPositionReport"
    ) {
      return this.ingestPositionReport(entityId, mmsi, metaData, message, messageType, receivedAt);
    }
    return { kind: "unsupported", reason: `message type ${messageType} is not used by Chokepoint` };
  }

  /** MMSI precedence: MetaData.MMSI, then the typed message's UserID. */
  private mmsiOf(metaData: Record<string, unknown>, message: Record<string, unknown>, messageType: string): number | null {
    if (typeof metaData["MMSI"] === "number" && Number.isInteger(metaData["MMSI"])) {
      return metaData["MMSI"];
    }
    const typed = message[messageType] as Record<string, unknown> | undefined;
    if (typed && typeof typed["UserID"] === "number" && Number.isInteger(typed["UserID"])) {
      return typed["UserID"];
    }
    return null;
  }

  private extractTypeCode(message: Record<string, unknown>, messageType: string): number | undefined {
    // ShipStaticData.Type and StaticDataReport.PartA.Type both carry the code.
    const typed = message[messageType] as Record<string, unknown> | undefined;
    if (!typed) return undefined;
    if (typeof typed["Type"] === "number") return typed["Type"];
    const partA = typed["PartA"] as Record<string, unknown> | undefined;
    if (partA && typeof partA["Type"] === "number") return partA["Type"];
    return undefined;
  }

  private ingestStaticData(entityId: string, message: Record<string, unknown>): AisNormalizationResult {
    const typeCode =
      this.extractTypeCode(message, "ShipStaticData") ?? this.extractTypeCode(message, "StaticDataReport");
    const mapped = mapAisShipTypeCode(typeCode);
    this.classificationCache.set(entityId, { entityType: mapped.entityType, classification: mapped.classification });
    return {
      kind: "classification-update",
      entityId,
      entityType: mapped.entityType,
      classification: mapped.classification,
    };
  }

  private ingestPositionReport(
    entityId: string,
    mmsi: number,
    metaData: Record<string, unknown>,
    message: Record<string, unknown>,
    messageType: string,
    receivedAt: string,
  ): AisNormalizationResult {
    const typed = message[messageType] as Record<string, unknown> | undefined;
    if (!typed || typeof typed !== "object") {
      return { kind: "invalid", reason: `missing Message.${messageType}` };
    }

    // Position precedence: the typed message's decoded position, then MetaData.
    const lat = typed["Latitude"] ?? metaData["latitude"];
    const lon = typed["Longitude"] ?? metaData["longitude"];
    if (typeof lat !== "number" || !Number.isFinite(lat)) {
      return { kind: "invalid", reason: "missing or non-numeric Latitude" };
    }
    if (typeof lon !== "number" || !Number.isFinite(lon)) {
      return { kind: "invalid", reason: "missing or non-numeric Longitude" };
    }

    const timeUtc = metaData["time_utc"] ?? metaData["TimeUTC"];
    if (typeof timeUtc !== "string") {
      return { kind: "invalid", reason: "missing MetaData.time_utc" };
    }
    const observedAt = parseAisStreamTimeUtc(timeUtc);
    if (observedAt === null) {
      return { kind: "invalid", reason: `unparseable time_utc: ${timeUtc}` };
    }

    const invalidLat = lat < -90 || lat > 90;
    const invalidLon = lon < -180 || lon > 180;
    if (invalidLat || invalidLon) {
      return { kind: "invalid", reason: "position outside WGS84 ranges (rejected, never clamped)" };
    }

    // Kinematics with sentinels mapped to "not available" (omitted).
    const kinematics: TransportObservation["kinematics"] = {};
    if (typeof typed["SOG"] === "number" && Number.isFinite(typed["SOG"]) && typed["SOG"] !== SOG_NOT_AVAILABLE) {
      kinematics.speedKnots = typed["SOG"];
    }
    const heading = typed["Heading"];
    if (typeof heading === "number" && Number.isFinite(heading) && heading !== HEADING_NOT_AVAILABLE) {
      kinematics.headingDegrees = heading;
    }
    const cog = typed["COG"];
    if (typeof cog === "number" && Number.isFinite(cog) && cog !== COG_NOT_AVAILABLE) {
      // COG is a course over ground; keep it as heading fallback when true heading is absent.
      if (kinematics.headingDegrees === undefined) kinematics.headingDegrees = cog;
    }

    const cached = this.classificationCache.get(entityId) ?? { entityType: "unknown" as EntityType, classification: "unknown" as AisFrameClassification };

    const observation: TransportObservation = {
      observationId: `aisstream:mmsi-${mmsi}:${observedAt}`,
      entityId,
      mode: "sea",
      entityType: cached.entityType,
      position: { latitude: lat, longitude: lon },
      kinematics,
      observedAt,
      receivedAt,
      source: {
        providerId: AISSTREAM_PROVIDER_ID,
        endpointId: AISSTREAM_ENDPOINT_ID,
        licenseId: AISSTREAM_LICENSE_ID,
      },
      quality: {
        sourceState: "fresh",
        positionAccuracy: "approximate",
        classification: cached.classification === "confirmed" ? "confirmed" : "unknown",
      },
    };
    return { kind: "observation", observation };
  }
}
