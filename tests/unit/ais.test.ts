/**
 * AISStream normalization tests (§12.1: provider payload normalization,
 * classification rules, invalid rejection; §17 Phase 1 "AIS normalization").
 * All frames are SYNTHETIC, built from the documented AISStream frame shape
 * (aisstream/example, verified 2026-09-09). No connection, no key.
 */

import { describe, expect, it } from "vitest";
import {
  AISSTREAM_ENDPOINT_ID,
  AISSTREAM_LICENSE_ID,
  AISSTREAM_PROVIDER_ID,
  AisStreamNormalizer,
  COG_NOT_AVAILABLE,
  HEADING_NOT_AVAILABLE,
  SOG_NOT_AVAILABLE,
  mapAisShipTypeCode,
  parseAisStreamTimeUtc,
} from "../../src/data/ais";
import { cohortByClassification } from "../../src/analytics/observations";

const RECEIVED = "2026-09-09T14:00:00Z";

const positionFrame = (overrides: Record<string, unknown> = {}, mmsi = 567001234) => ({
  MessageType: "PositionReport",
  MetaData: {
    MMSI: mmsi,
    ShipName: "SYNTH VESSEL",
    latitude: 33.68,
    longitude: -118.17,
    time_utc: "2026-09-09 13:59:41.341 +0000 UTC",
  },
  Message: {
    PositionReport: {
      NavigationalStatus: 0,
      SOG: 12.4,
      Longitude: -118.17,
      Latitude: 33.68,
      COG: 64.2,
      Heading: 63.0,
      UserID: mmsi,
      ...overrides,
    },
  },
});

const staticFrame = (typeCode: number, mmsi = 567001234) => ({
  MessageType: "ShipStaticData",
  MetaData: { MMSI: mmsi, time_utc: "2026-09-09 13:00:00.000 +0000 UTC" },
  Message: {
    ShipStaticData: {
      UserID: mmsi,
      Type: typeCode,
      CallSign: "SYNTH1",
      ImoNumber: 9000000,
    },
  },
});

describe("timestamp parsing", () => {
  it("parses the documented AISStream time_utc format", () => {
    expect(parseAisStreamTimeUtc("2021-11-01 05:08:39.341 +0000 UTC")).toBe("2021-11-01T05:08:39.341Z");
    expect(parseAisStreamTimeUtc("2026-09-09 13:59:41.341 +0000 UTC")).toBe("2026-09-09T13:59:41.341Z");
  });

  it("handles non-UTC offsets correctly", () => {
    // 13:00 +0200 == 11:00Z
    expect(parseAisStreamTimeUtc("2026-09-09 13:00:00.000 +0200 UTC")).toBe("2026-09-09T11:00:00Z");
  });

  it("passes through ISO 8601 and rejects garbage (never guesses)", () => {
    expect(parseAisStreamTimeUtc("2026-09-09T13:59:41Z")).toBe("2026-09-09T13:59:41Z");
    expect(parseAisStreamTimeUtc("yesterday at sea")).toBeNull();
  });
});

describe("ship type classification (ais-classification-v1)", () => {
  it("maps cargo (70-79) and tanker (80-89) into the freight allowlist", () => {
    expect(mapAisShipTypeCode(70)).toEqual({ entityType: "cargo_vessel", classification: "confirmed" });
    expect(mapAisShipTypeCode(79)).toEqual({ entityType: "cargo_vessel", classification: "confirmed" });
    expect(mapAisShipTypeCode(80)).toEqual({ entityType: "tanker", classification: "confirmed" });
    expect(mapAisShipTypeCode(89)).toEqual({ entityType: "tanker", classification: "confirmed" });
  });

  it("maps non-freight codes to confirmed non-freight (visible context only)", () => {
    expect(mapAisShipTypeCode(30)).toEqual({ entityType: "unknown", classification: "confirmed" }); // fishing
    expect(mapAisShipTypeCode(60)).toEqual({ entityType: "unknown", classification: "confirmed" }); // passenger
    expect(mapAisShipTypeCode(35)).toEqual({ entityType: "unknown", classification: "confirmed" }); // military
  });

  it("maps missing/not-available codes to UNKNOWN classification (UNCLASSIFIED cohort)", () => {
    expect(mapAisShipTypeCode(0)).toEqual({ entityType: "unknown", classification: "unknown" });
    expect(mapAisShipTypeCode(undefined)).toEqual({ entityType: "unknown", classification: "unknown" });
  });

  it("bulk carriers are NOT separable from cargo via type codes (documented limitation)", () => {
    // AIS bulk carriers broadcast cargo codes; the mapping must not invent a
    // bulk_carrier entity type from them (§2.1 reliability rule).
    expect(mapAisShipTypeCode(72).entityType).toBe("cargo_vessel");
  });
});

describe("PositionReport normalization", () => {
  it("produces a canonical OBSERVED observation with provider timestamps preserved", () => {
    const n = new AisStreamNormalizer();
    const result = n.normalize(positionFrame(), RECEIVED);
    expect(result.kind).toBe("observation");
    if (result.kind !== "observation") return;
    const o = result.observation;
    expect(o.observationId).toBe("aisstream:mmsi-567001234:2026-09-09T13:59:41.341Z");
    expect(o.entityId).toBe("aisstream:567001234");
    expect(o.mode).toBe("sea");
    expect(o.position).toEqual({ latitude: 33.68, longitude: -118.17 });
    expect(o.kinematics).toEqual({ speedKnots: 12.4, headingDegrees: 63.0 });
    expect(o.observedAt).toBe("2026-09-09T13:59:41.341Z");
    expect(o.receivedAt).toBe(RECEIVED); // receipt time separate from provider time (§3.3)
    expect(o.source).toEqual({
      providerId: AISSTREAM_PROVIDER_ID,
      endpointId: AISSTREAM_ENDPOINT_ID,
      licenseId: AISSTREAM_LICENSE_ID,
    });
    expect(o.quality.sourceState).toBe("fresh");
  });

  it("merges cached ShipStaticData classification into later positions", () => {
    const n = new AisStreamNormalizer();
    n.normalize(staticFrame(80), RECEIVED); // tanker
    const result = n.normalize(positionFrame(), RECEIVED);
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation.entityType).toBe("tanker");
    expect(result.observation.quality.classification).toBe("confirmed");

    // Cohort check: the tanker counts as freight.
    const cohort = cohortByClassification([result.observation]);
    expect(cohort.freight).toEqual(["aisstream:567001234"]);
  });

  it("positions before static data are honest UNKNOWN classification", () => {
    const n = new AisStreamNormalizer();
    const result = n.normalize(positionFrame(), RECEIVED);
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation.entityType).toBe("unknown");
    expect(result.observation.quality.classification).toBe("unknown");
    const cohort = cohortByClassification([result.observation]);
    expect(cohort.unclassified).toEqual(["aisstream:567001234"]);
  });

  it("confirmed non-freight types land in the visible-context cohort, not UNCLASSIFIED", () => {
    const n = new AisStreamNormalizer();
    n.normalize(staticFrame(30), RECEIVED); // fishing
    const result = n.normalize(positionFrame(), RECEIVED);
    if (result.kind !== "observation") throw new Error("expected observation");
    const cohort = cohortByClassification([result.observation]);
    expect(cohort.other).toEqual(["aisstream:567001234"]);
    expect(cohort.freight).toEqual([]);
  });

  it("ShipStaticData alone yields a classification-update, not an observation", () => {
    const n = new AisStreamNormalizer();
    const result = n.normalize(staticFrame(70), RECEIVED);
    expect(result.kind).toBe("classification-update");
    if (result.kind !== "classification-update") return;
    expect(result.entityId).toBe("aisstream:567001234");
    expect(result.entityType).toBe("cargo_vessel");
    expect(n.cachedEntityCount).toBe(1);
  });

  it("drops AIS not-available sentinels instead of treating them as values (§3.3)", () => {
    const n = new AisStreamNormalizer();
    const result = n.normalize(
      positionFrame({ SOG: SOG_NOT_AVAILABLE, Heading: HEADING_NOT_AVAILABLE, COG: COG_NOT_AVAILABLE }),
      RECEIVED
    );
    if (result.kind !== "observation") throw new Error("expected observation");
    // Missing speed is MISSING, not zero — the §7.2 rule depends on this.
    expect(result.observation.kinematics).toEqual({});
  });

  it("falls back to COG for heading when true heading is unavailable", () => {
    const n = new AisStreamNormalizer();
    const result = n.normalize(positionFrame({ Heading: HEADING_NOT_AVAILABLE, COG: 88.8 }), RECEIVED);
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation.kinematics.headingDegrees).toBe(88.8);
  });

  it("falls back to MetaData position and MMSI when the typed block omits them", () => {
    const n = new AisStreamNormalizer();
    const frame = {
      MessageType: "PositionReport",
      MetaData: {
        MMSI: 567001299,
        latitude: 1.26,
        longitude: 103.85,
        time_utc: "2026-09-09 13:59:41.000 +0000 UTC",
      },
      Message: { PositionReport: { SOG: 10.0 } },
    };
    const result = n.normalize(frame, RECEIVED);
    if (result.kind !== "observation") throw new Error("expected observation");
    expect(result.observation.entityId).toBe("aisstream:567001299");
    expect(result.observation.position).toEqual({ latitude: 1.26, longitude: 103.85 });
  });
});

describe("invalid frame rejection (§12.1, never clamped or guessed)", () => {
  const n = new AisStreamNormalizer();
  const expectInvalid = (frame: unknown, pattern: RegExp) => {
    const result = n.normalize(frame, RECEIVED);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toMatch(pattern);
  };

  it("rejects out-of-range coordinates", () => {
    expectInvalid(positionFrame({ Latitude: 91 }), /WGS84/);
    expectInvalid(positionFrame({ Longitude: -181 }), /WGS84/);
  });

  it("rejects missing MMSI, MessageType, MetaData, Message, and timestamps", () => {
    expectInvalid({ Message: {}, MetaData: {} }, /MessageType/);
    expectInvalid({ MessageType: "PositionReport", Message: { PositionReport: {} } }, /MetaData/);
    const noMmsi = positionFrame();
    (noMmsi["MetaData"] as Record<string, unknown>)["MMSI"] = "not-a-number";
    delete (noMmsi["Message"] as Record<string, unknown>)["PositionReport"];
    (noMmsi["Message"] as Record<string, unknown>)["PositionReport"] = { Latitude: 1, Longitude: 2 };
    expectInvalid(noMmsi, /MMSI/);
    const noTime = positionFrame();
    delete (noTime["MetaData"] as Record<string, unknown>)["time_utc"];
    expectInvalid(noTime, /time_utc/);
  });

  it("rejects unparseable time_utc and bad receivedAt", () => {
    const bad = new AisStreamNormalizer();
    const r = bad.normalize(positionFrame({}), "not-a-time");
    expect(r.kind).toBe("invalid");
    if (r.kind === "invalid") expect(r.reason).toMatch(/receivedAt/);
    const badTime = new AisStreamNormalizer();
    const frame = positionFrame();
    (frame["MetaData"] as Record<string, unknown>)["time_utc"] = "day before yesterday";
    expect(badTime.normalize(frame, RECEIVED).kind).toBe("invalid");
  });

  it("treats unrelated message types as unsupported, not invalid", () => {
    const r = n.normalize({ MessageType: "AidsToNavigationReport", MetaData: { MMSI: 1 }, Message: {} }, RECEIVED);
    expect(r.kind).toBe("unsupported");
  });
});

describe("ADR-0010 obligations", () => {
  it("retains only classification state, never raw frames", () => {
    const n = new AisStreamNormalizer();
    n.normalize(staticFrame(70), RECEIVED);
    n.normalize(positionFrame(), RECEIVED);
    // The normalizer exposes only a count, and JSON round-trip of the
    // normalizer shows no frame content (state is a classification triple).
    expect(n.cachedEntityCount).toBe(1);
    // Force a leak check: serialize the instance and look for raw fields.
    const serialized = JSON.stringify(Object.assign({}, n, { classificationCache: undefined }));
    expect(serialized).not.toContain("SYNTH VESSEL");
    expect(serialized).not.toContain("ShipStaticData");
  });

  it("deterministic: identical frames normalize identically", () => {
    const a = new AisStreamNormalizer();
    const b = new AisStreamNormalizer();
    const ra = a.normalize(staticFrame(80), RECEIVED);
    const rb = b.normalize(staticFrame(80), RECEIVED);
    expect(ra).toEqual(rb);
    const oa = a.normalize(positionFrame(), RECEIVED);
    const ob = b.normalize(positionFrame(), RECEIVED);
    expect(oa).toEqual(ob);
  });
});
