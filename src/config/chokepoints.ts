/**
 * Chokepoint profiles (CHOKEPOINT-PLAN.md §4.3, §2.1).
 *
 * Configuration is data-driven: supported locations are records in this
 * registry, never conditionals scattered through UI code. Each profile is a
 * versioned configuration with provenance fields.
 *
 * GEOMETRY STATUS (v1, ADR-0011): all six geofences are REVIEWED geometry,
 * approved 2026-09-09 by the review owner below. Candidate provenance lives in
 * research/geofence-candidates.md (per-vertex [CFR]/[SCA]/[OSM]/[APPROX] tags);
 * the strongest fences anchor on federal regulation (33 CFR) or the Suez Canal
 * Authority Rules of Navigation; the Singapore corridor is all-approximate and
 * flagged for a v2 re-derivation from IMO Ships' Routeing.
 *
 * Reviewed geometry is a coarse DEMO fence, never an official port boundary
 * (§4.3 limitation, kept on every profile). Membership computation goes through
 * src/data/geofences.ts, which re-validates status at the point of use.
 */

export type TransportMode = "sea" | "air" | "land" | "rail";

export type MetricType =
  | "vessel_count"
  | "moving_fraction"
  | "entry_count"
  | "exit_count"
  | "dwell_estimate";

export type GeofencePurpose =
  | "waiting-cohort"
  | "approach-flow"
  | "port-basin"
  | "canal-corridor";

/** Coordinate reference system for geometry. */
export type CoordinateReference = "EPSG:4326";

/** An ordered ring of [lat, lon] pairs (WGS84). */
export type PolygonRing = ReadonlyArray<readonly [number, number]>;

export type GeofenceGeometry =
  | { kind: "polygon"; ring: PolygonRing }
  | { kind: "placeholder-bbox"; minLat: number; minLon: number; maxLat: number; maxLon: number };

export interface ChokepointProfile {
  id: string;
  name: string;
  region: string;
  mode: TransportMode;
  configVersion: string;
  /** Date the profile definition (not necessarily geometry) was last revised. */
  revisedAt: string;
  geofences: Geofence[];
  supportedMetrics: MetricType[];
  limitations: string[];
}

export interface Geofence {
  id: string;
  purpose: GeofencePurpose;
  geometryVersion: string;
  geometryStatus: "placeholder" | "reviewed";
  /** Named reviewer who approved this geometry version (null while placeholder). */
  reviewOwner: string | null;
  /** ISO date the geometry version took effect (null while placeholder). */
  effectiveDate: string | null;
  /** Plain-language inclusion rule (§5.4; null while placeholder). */
  inclusionRule: string | null;
  geometry: GeofenceGeometry;
  coordinateReference: CoordinateReference;
  rationale: string;
}

/**
 * Designated review owner for geofence geometry (§5.4).
 */
export const DESIGNATED_GEOMETRY_REVIEW_OWNER = "ChrisSchmidt (GitHub: PCSchmidt)";

/** Inclusion rules by fence purpose (§5.4); membership uses even-odd ray casting. */
export const INCLUSION_RULES = {
  waitingCohort:
    "Point-in-polygon (even-odd ray casting), no margin. All vessel states count; separating anchored from underway traffic is the metrics' responsibility, not the fence's.",
  approachFlow:
    "Point-in-polygon (even-odd ray casting), no margin. The fence approximates a traffic system (TSS lanes or SCA waiting areas); boundary edges are coarse, so single-crossing counts carry geometric uncertainty.",
} as const;

export function isPlaceholder(fence: Geofence): boolean {
  return fence.geometryStatus === "placeholder";
}

/**
 * Guard: refuse to run any geofence-membership logic against placeholder
 * geometry. Reviewed fences pass; membership re-validates in src/data/geofences.ts.
 */
export function assertUsableGeofence(fence: Geofence): void {
  if (isPlaceholder(fence)) {
    throw new Error(
      `Geofence "${fence.id}" has placeholder geometry and is not reviewed. ` +
        `Refusing to compute membership (plan sections 5.4 and 20.4; ADR-0007).`
    );
  }
}

// ---------------------------------------------------------------------------
// MVP chokepoint definitions (§2.1) with reviewed geometry v1 (ADR-0011).
// ---------------------------------------------------------------------------

export const LONG_BEACH_APPROACH: ChokepointProfile = {
  id: "long-beach-approach",
  name: "Los Angeles / Long Beach",
  region: "North America",
  mode: "sea",
  configVersion: "0.2.0",
  revisedAt: "2026-09-09",
  geofences: [
    {
      id: "outer-anchorage",
      purpose: "waiting-cohort",
      geometryVersion: "2026-09-09-v1",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-09",
      inclusionRule: INCLUSION_RULES.waitingCohort,
      coordinateReference: "EPSG:4326",
      // Geometry v1: union of 33 CFR §110.214 Commercial Anchorages F and G
      // corner coordinates [CFR], with two interpolated southern-edge vertices
      // [APPROX]. See research/geofence-candidates.md §1 for per-vertex notes.
      rationale: "Waiting cohort = fleet holding outside the federal breakwater in San Pedro Bay (anchorages F and G, VTIS-assigned). CFR corners verbatim; southern edge interpolated over open water.",
      geometry: {
        kind: "polygon",
        ring: [
          [33.7182, -118.2052],
          [33.7181, -118.1768],
          [33.7181, -118.1331],
          [33.6731, -118.1008],
          [33.6382, -118.1167],
          [33.67, -118.19],
          [33.695, -118.225],
          [33.7072, -118.2387],
        ],
      },
    },
    {
      id: "approach-corridor",
      purpose: "approach-flow",
      geometryVersion: "2026-09-09-v1",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-09",
      inclusionRule: INCLUSION_RULES.approachFlow,
      coordinateReference: "EPSG:4326",
      // Geometry v1: convex hull over the 33 CFR §167.500–503 southern-approach
      // TSS lane ends and separation-zone corners [CFR], with interpolated edge
      // midpoints [APPROX]. See research/geofence-candidates.md §2.
      rationale: "Approach flow = the official southern-approach TSS: separation zone plus northbound and southbound lanes converging on the precautionary area at the bay entrance. Lane ends are CFR-verbatim; the hull covers lanes and buffer water.",
      geometry: {
        kind: "polygon",
        ring: [
          [33.5917, -118.2333],
          [33.5917, -118.1917],
          [33.5917, -118.15],
          [33.4625, -118.0942],
          [33.3333, -118.0383],
          [33.325, -118.0758],
          [33.3167, -118.1125],
          [33.4542, -118.1729],
        ],
      },
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction", "entry_count", "exit_count", "dwell_estimate"],
  limitations: [
    "AIS coverage does not represent every vessel",
    "geofence does not equal official port boundary",
    "anchorage fence merges CFR Anchorages F and G and includes open water between them; the southern edge is interpolated, not a regulatory line",
    "approach fence is a hull over the southern-approach TSS: it covers lanes, separation zone, and buffer water, and does not encode lane direction",
    "CFR coordinates are NAD 83 (~1 m offset from WGS84; immaterial at this scale)",
  ],
};

export const SINGAPORE_MALACCA_APPROACH: ChokepointProfile = {
  id: "singapore-malacca-approach",
  name: "Singapore / Malacca Approach",
  region: "Southeast Asia",
  mode: "sea",
  configVersion: "0.2.0",
  revisedAt: "2026-09-09",
  geofences: [
    {
      id: "strait-traffic-corridor",
      purpose: "approach-flow",
      geometryVersion: "2026-09-09-v1",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-09",
      inclusionRule: INCLUSION_RULES.approachFlow,
      coordinateReference: "EPSG:4326",
      // Geometry v1 — WEAKEST FENCE: ALL 12 vertices [APPROX], estimated from
      // the MPA anchorage chartlet and published strait scale; the IMO TSS
      // limits were not digitized. Flagged for a future v2 re-derivation from
      // IMO Ships' Routeing. See research/geofence-candidates.md §3.
      rationale: "Corridor proxy along the Singapore Strait TSS between Singapore (north) and the Riau islands (south), WSW-ENE. Every vertex is approximate (+-0.05 deg); counts in this fence carry that uncertainty.",
      geometry: {
        kind: "polygon",
        ring: [
          [1.26, 103.61],
          [1.25, 103.75],
          [1.265, 103.85],
          [1.3, 103.95],
          [1.27, 104.15],
          [1.24, 104.28],
          [1.13, 104.3],
          [1.09, 104.18],
          [1.13, 104.1],
          [1.15, 103.96],
          [1.11, 103.84],
          [1.17, 103.62],
        ],
      },
    },
    {
      id: "singapore-roadstead",
      purpose: "waiting-cohort",
      geometryVersion: "2026-09-09-v1",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-09",
      inclusionRule: INCLUSION_RULES.waitingCohort,
      coordinateReference: "EPSG:4326",
      // Geometry v1: buffered convex hull over OpenStreetMap
      // seamark:type=anchorage polygons for the eastern anchorage cluster
      // (MPA codes AEW/AEBA/AEBB/AEPA/AEGP etc.) [OSM-derived].
      // ODbL 1.0: attribution required; share-alike applies to redistributed
      // derived databases. See research/geofence-candidates.md §4.
      rationale: "Waiting cohort = the eastern anchorage cluster east of ~103.85E (working, bunkering, petroleum, holding, laid-up anchorages). OSM tracing of the official MPA layout, +0.02 deg buffer, simplified.",
      geometry: {
        kind: "polygon",
        ring: [
          [1.264, 103.844],
          [1.237, 103.848],
          [1.213, 103.89],
          [1.279, 104.103],
          [1.3, 104.116],
          [1.35, 104.076],
          [1.368, 104.049],
          [1.301, 103.876],
          [1.286, 103.854],
        ],
      },
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction", "entry_count", "exit_count", "dwell_estimate"],
  limitations: [
    "AIS coverage does not represent every vessel",
    "geofence does not equal official port boundary",
    "strait-traffic-corridor vertices are ALL approximate (+-0.05 deg, estimated from the MPA chartlet, not digitized from IMO Ships' Routeing); counts there carry that uncertainty",
    "singapore-roadstead is OSM-derived: ODbL attribution required, share-alike applies to redistributed derived databases",
    "the corridor and roadstead fences overlap along the TSS; anchored-vs-underway separation must come from AIS state, not the fences",
  ],
};

export const SUEZ_CANAL_APPROACHES: ChokepointProfile = {
  id: "suez-canal-approaches",
  name: "Suez Canal Approaches",
  region: "Middle East / North Africa",
  mode: "sea",
  configVersion: "0.2.0",
  revisedAt: "2026-09-09",
  geofences: [
    {
      id: "gulf-of-suez-approach",
      purpose: "approach-flow",
      geometryVersion: "2026-09-09-v1",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-09",
      inclusionRule: INCLUSION_RULES.approachFlow,
      coordinateReference: "EPSG:4326",
      // Geometry v1: envelope with margins around SCA Rules of Navigation
      // (2020) Art. 9 published features [SCA points; all vertices APPROX
      // envelopes]: separation-zone buoys, V berths, East/West Waiting Areas,
      // STS areas A/B, entrance buoys. Edges are inferred, not chart lines.
      rationale: "Southern (Red Sea) approach where northbound convoys gather: bounds the whole SCA waiting/transfer system from ~29.59N to the canal entrance (~29.93N). Entry into the fence approximates arrival into the Suez waiting system.",
      geometry: {
        kind: "polygon",
        ring: [
          [29.93, 32.545],
          [29.93, 32.59],
          [29.89, 32.6],
          [29.74, 32.64],
          [29.59, 32.61],
          [29.59, 32.43],
          [29.65, 32.385],
          [29.73, 32.42],
          [29.82, 32.48],
          [29.87, 32.52],
        ],
      },
    },
    {
      id: "port-said-approach",
      purpose: "approach-flow",
      geometryVersion: "2026-09-09-v1",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-09",
      inclusionRule: INCLUSION_RULES.approachFlow,
      coordinateReference: "EPSG:4326",
      // Geometry v1: envelope around SCA Rules of Navigation (2020) Art. 8
      // published anchorage zones [SCA points; all vertices APPROX]:
      // Northern Area zones 1-3, Southern Area C berths, trans-shipment areas.
      // NOTE: SCA Zone 1 east limit contains an apparent source typo (a
      // latitude repeated where a longitude is expected); treated as
      // 32deg27.0'E pending chart verification.
      rationale: "Northern (Mediterranean) approach where southbound convoys queue: bounds the SCA Northern and Southern anchorage areas and trans-shipment zones from ~31deg30'N down to just north of the Port Said coast.",
      geometry: {
        kind: "polygon",
        ring: [
          [31.5, 32.29],
          [31.5, 32.48],
          [31.35, 32.48],
          [31.34, 32.4],
          [31.33, 32.34],
          [31.33, 32.27],
          [31.35, 32.26],
          [31.4, 32.26],
          [31.43, 32.28],
        ],
      },
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction", "entry_count", "exit_count", "dwell_estimate"],
  limitations: [
    "AIS coverage does not represent every vessel",
    "geofence does not equal official canal authority boundaries",
    "SCA publishes points, not outlines: fence edges are inferred envelopes around published buoy/berth coordinates and may touch the intertidal zone in places",
    "one apparent SCA source typo (Zone 1 east limit) is treated as 32deg27.0'E pending chart verification",
    "STS transfer occupancy can inflate waiting counts; vessel state must come from AIS, not the fence",
  ],
};

// ---------------------------------------------------------------------------
// Multimodal profiles (ADR-0012/0013/0015). GEOMETRY IS PLACEHOLDER: per
// ADR-0007/0011 the reviewed-geometry step is a deliberate human-approval
// gate, and the §6.1 admission decision does NOT approve geometry. Candidates
// below use coarse bbox placeholders around the named facility; they block
// metric computation via assertUsableGeofence() until a human review owner
// approves v1 coordinates with provenance (see research/geofence-candidates.md).
// ---------------------------------------------------------------------------

/**
 * AIR: Los Angeles cargo-aircraft monitoring area. Purpose: observe freight
 * operators (inferred cohorts, ADR-0012) on approach/departure paths around
 * LAX. The bbox is a large coarse placeholder, NOT reviewed geometry — it
 * must not be used for any membership computation until reviewed (the guard
 * throws by design).
 */
export const LAX_CARGO_AIR: ChokepointProfile = {
  id: "lax-cargo-air",
  name: "Los Angeles Cargo Air",
  region: "North America",
  mode: "air",
  configVersion: "0.3.0",
  revisedAt: "2026-09-10",
  geofences: [
    {
      // Approved v1 2026-09-10 by ChrisSchmidt (GitHub: PCSchmidt) — see
      // research/geofence-candidates.md §8. Bbox extents are [APPROX] by
      // design (regional adsb.lol query region, ADR-0012); a v2 could tighten
      // along published FAA approach procedures.
      id: "lax-cargo-approach",
      purpose: "approach-flow",
      geometryVersion: "lax-v1-2026-09-10",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-10",
      inclusionRule:
        "Aircraft (mode air) with at least one adsb.lol position inside this box during the window; freight-operator cohorts are inferred from provider-published metadata per ADR-0012.",
      coordinateReference: "EPSG:4326",
      rationale:
        "Cargo-aircraft observation area around LAX (KLAX). Anchored on the OSM-verified KLAX aerodrome reference point [OSM 33.9422, -118.4214]; extents [APPROX] cover the Pacific-side approach/departure corridors where westbound flow holds. Data source: adsb.lol (ADR-0012), operator cohorts inferred from provider-published metadata only.",
      geometry: {
        kind: "polygon",
        ring: [
          [33.95, -118.65],
          [33.95, -118.25],
          [33.7, -118.25],
          [33.7, -118.65],
        ],
      },
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction"],
  limitations: [
    "Geofence v1 is a coarse regional query/display region, not an official FAA sector; a v2 could tighten along published FAA approach procedures (ADR-0012)",
    "Aircraft broadcast no cargo flag: freight-operator cohorts are inferred from provider-published metadata and callsign heuristics (classification: inferred, ADR-0012)",
    "adsb.lol coverage follows community receiver density; regional observed context, never worldwide completeness",
    "aircraft counts use air-traffic vocabulary, not vessel vocabulary — counts are 'aircraft observed', never 'vessels'",
  ],
};

/**
 * LAND: El Paso border crossings (CBP, ADR-0013). Facility-level: the CBP
 * adapter emits FacilityMetric records keyed by facilityId, NOT
 * TransportObservations. The placeholder fence only frames the map view; it
 * is not used for entity membership and stays blocked until reviewed.
 */
export const EL_PASO_BORDER_CROSSINGS: ChokepointProfile = {
  id: "el-paso-border-crossings",
  name: "El Paso Border Crossings",
  region: "North America",
  mode: "land",
  configVersion: "0.3.0",
  revisedAt: "2026-09-10",
  geofences: [
    {
      // Approved v1 2026-09-10 by ChrisSchmidt (GitHub: PCSchmidt). The
      // BOTA frame is anchored on the OSM-verified crossing point
      // [OSM 31.7652, -106.4516]; extents [APPROX]. FRAMING ONLY: facility
      // metrics key on facilityId (ADR-0013/0015), never on membership.
      id: "el-paso-crossings-area",
      purpose: "port-basin",
      geometryVersion: "el-paso-v1-2026-09-10",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-10",
      inclusionRule:
        "Display framing for the El Paso crossing cluster; facility metrics are keyed by facilityId (cbp:240201:bridge, cbp:240203:ysleta) and are NOT geofence-membership computations (ADR-0013/0015).",
      coordinateReference: "EPSG:4326",
      rationale:
        "Frames the El Paso crossing cluster (BOTA 240201, Ysleta 240203) for map display. Anchored on OSM-verified crossing points; APPROX extents cover the bridge approach roads. Not an official port boundary (§4.3).",
      geometry: {
        kind: "polygon",
        ring: [
          [31.775, -106.47],
          [31.775, -106.43],
          [31.755, -106.43],
          [31.755, -106.47],
        ],
      },
    },
    {
      // Approved v1 2026-09-10 by ChrisSchmidt (GitHub: PCSchmidt). Anchored
      // on the OSM-verified Ysleta Port of Entry [OSM 31.6725, -106.3360];
      // extents [APPROX]. Same framing-only rule as the BOTA frame.
      id: "ysleta-crossings-area",
      purpose: "port-basin",
      geometryVersion: "el-paso-v1-2026-09-10",
      geometryStatus: "reviewed",
      reviewOwner: DESIGNATED_GEOMETRY_REVIEW_OWNER,
      effectiveDate: "2026-09-10",
      inclusionRule:
        "Display framing for the Ysleta crossing; facility metrics are keyed by facilityId (cbp:240203:ysleta) and are NOT geofence-membership computations (ADR-0013/0015).",
      coordinateReference: "EPSG:4326",
      rationale:
        "Frames the Ysleta crossing (240203) for map display. Anchored on the OSM-verified Ysleta Port of Entry point [OSM 31.6725, -106.3360]; APPROX extents cover the crossing approach roads. Not an official port boundary (§4.3).",
      geometry: {
        kind: "polygon",
        ring: [
          [31.682, -106.345],
          [31.682, -106.325],
          [31.663, -106.325],
          [31.663, -106.345],
        ],
      },
    },
  ],
  supportedMetrics: ["vessel_count"],
  limitations: [
    "Geofence v1 is display framing only; facility metrics key on facilityId, not membership (ADR-0013/0015)",
    "US-side data only: wait times measure inbound-to-US lanes as published by CBP; no Mexican or Canadian authority data",
    "Update cadence is per-port and periodic; hours-stale readings at quiet crossings are normal (lane update_time shown verbatim)",
    "wait_minutes is an OBSERVED facility value reported by CBP; Chokepoint derives nothing from it in v1 (ADR-0013)",
  ],
};

/** All supported profiles: three maritime MVPs (§2.1) + two multimodal candidates. */
export const CHOKEPOINT_REGISTRY: readonly ChokepointProfile[] = [
  LONG_BEACH_APPROACH,
  SINGAPORE_MALACCA_APPROACH,
  SUEZ_CANAL_APPROACHES,
  LAX_CARGO_AIR,
  EL_PASO_BORDER_CROSSINGS,
];

export function getChokepoint(id: string): ChokepointProfile | undefined {
  return CHOKEPOINT_REGISTRY.find((c) => c.id === id);
}
