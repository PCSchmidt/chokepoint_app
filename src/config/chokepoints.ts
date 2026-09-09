/**
 * Chokepoint profiles (CHOKEPOINT-PLAN.md §4.3, §2.1).
 *
 * Configuration is data-driven: supported locations are records in this
 * registry, never conditionals scattered through UI code. Each profile is a
 * versioned configuration with provenance fields.
 *
 * GEOMETRY STATUS: every geofence below uses `geometryStatus: "placeholder"`.
 * The placeholder geometry is an intentionally coarse bounding box that marks
 * the general area ONLY. It has NOT been reviewed and MUST NOT be used for
 * geofence membership, entry/exit detection, or any metric computation.
 * Real coordinates require review and a versioned commit (§5.4, §20 step 4).
 * `assertUsableGeofence()` throws if placeholder geometry is consumed.
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

/** Coordinate reference system for geometry. Placeholder assumes WGS84. */
export type CoordinateReference = "EPSG:4326";

/**
 * A rectangle used ONLY as a review placeholder. Not a reviewed geofence.
 */
export interface PlaceholderBoundingBox {
  kind: "placeholder-bbox";
  /** South-west corner [lat, lon]. */
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export type GeofenceGeometry = PlaceholderBoundingBox;

export interface Geofence {
  id: string;
  purpose: GeofencePurpose;
  geometryVersion: string;
  geometryStatus: "placeholder" | "reviewed";
  /** Set once the geometry is reviewed; identifies the reviewer. */
  reviewOwner: string | null;
  geometry: GeofenceGeometry;
  coordinateReference: CoordinateReference;
  rationale: string;
}

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

export function isPlaceholder(fence: Geofence): boolean {
  return fence.geometryStatus === "placeholder";
}

/**
 * Guard: refuse to run any geofence-membership logic against placeholder
 * geometry. Callers (Phase 2 analytics) must invoke this before use.
 */
export function assertUsableGeofence(fence: Geofence): void {
  if (isPlaceholder(fence)) {
    throw new Error(
      `Geofence "${fence.id}" has placeholder geometry and is not reviewed. ` +
        `Refusing to compute membership. Provide reviewed coordinates and set ` +
        `geometryStatus: "reviewed" first (plan sections 5.4 and 20.4).`
    );
  }
}

// ---------------------------------------------------------------------------
// MVP chokepoint definitions (§2.1). Placeholder bounding boxes are coarse
// orientation markers, NOT reviewed geofence polygons.
// ---------------------------------------------------------------------------

export const LONG_BEACH_APPROACH: ChokepointProfile = {
  id: "long-beach-approach",
  name: "Los Angeles / Long Beach",
  region: "North America",
  mode: "sea",
  configVersion: "0.1.0",
  revisedAt: "2026-09-01",
  geofences: [
    {
      id: "outer-anchorage",
      purpose: "waiting-cohort",
      geometryVersion: "placeholder-0",
      geometryStatus: "placeholder",
      reviewOwner: null,
      coordinateReference: "EPSG:4326",
      // PLACEHOLDER: rough bounding box around the San Pedro Bay anchorages.
      // Needs real reviewed polygon coordinates before use.
      geometry: { kind: "placeholder-bbox", minLat: 33.55, minLon: -118.25, maxLat: 33.78, maxLon: -118.05 },
      rationale: "Placeholder bounds marking the outer anchorage area; awaiting reviewed geofence.",
    },
    {
      id: "approach-corridor",
      purpose: "approach-flow",
      geometryVersion: "placeholder-0",
      geometryStatus: "placeholder",
      reviewOwner: null,
      coordinateReference: "EPSG:4326",
      // PLACEHOLDER: rough bounding box along the inbound approach.
      geometry: { kind: "placeholder-bbox", minLat: 33.5, minLon: -118.4, maxLat: 33.75, maxLon: -118.1 },
      rationale: "Placeholder bounds marking the approach corridor; awaiting reviewed geofence.",
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction", "entry_count", "exit_count", "dwell_estimate"],
  limitations: [
    "AIS coverage does not represent every vessel",
    "geofence does not equal official port boundary",
    "geofence coordinates are placeholders pending review",
  ],
};

export const SINGAPORE_MALACCA_APPROACH: ChokepointProfile = {
  id: "singapore-malacca-approach",
  name: "Singapore / Malacca Approach",
  region: "Southeast Asia",
  mode: "sea",
  configVersion: "0.1.0",
  revisedAt: "2026-09-01",
  geofences: [
    {
      id: "strait-traffic-corridor",
      purpose: "approach-flow",
      geometryVersion: "placeholder-0",
      geometryStatus: "placeholder",
      reviewOwner: null,
      coordinateReference: "EPSG:4326",
      // PLACEHOLDER: rough bounding box around the Strait of Malacca approach
      // toward Singapore. Needs real reviewed corridor geometry before use.
      geometry: { kind: "placeholder-bbox", minLat: 1.0, minLon: 103.4, maxLat: 1.6, maxLon: 104.3 },
      rationale: "Placeholder bounds marking the Malacca/Singapore approach; awaiting reviewed geofence.",
    },
    {
      id: "singapore-roadstead",
      purpose: "waiting-cohort",
      geometryVersion: "placeholder-0",
      geometryStatus: "placeholder",
      reviewOwner: null,
      coordinateReference: "EPSG:4326",
      // PLACEHOLDER: rough bounding box around the eastern anchorage areas.
      geometry: { kind: "placeholder-bbox", minLat: 1.1, minLon: 103.8, maxLat: 1.35, maxLon: 104.1 },
      rationale: "Placeholder bounds marking anchorage areas; awaiting reviewed geofence.",
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction", "entry_count", "exit_count", "dwell_estimate"],
  limitations: [
    "AIS coverage does not represent every vessel",
    "geofence does not equal official port boundary",
    "geofence coordinates are placeholders pending review",
  ],
};

export const SUEZ_CANAL_APPROACHES: ChokepointProfile = {
  id: "suez-canal-approaches",
  name: "Suez Canal Approaches",
  region: "Middle East / North Africa",
  mode: "sea",
  configVersion: "0.1.0",
  revisedAt: "2026-09-01",
  geofences: [
    {
      id: "gulf-of-suez-approach",
      purpose: "approach-flow",
      geometryVersion: "placeholder-0",
      geometryStatus: "placeholder",
      reviewOwner: null,
      coordinateReference: "EPSG:4326",
      // PLACEHOLDER: rough bounding box around the southern (Red Sea) approach.
      geometry: { kind: "placeholder-bbox", minLat: 27.5, minLon: 33.2, maxLat: 29.9, maxLon: 33.6 },
      rationale: "Placeholder bounds marking the southern approach; awaiting reviewed geofence.",
    },
    {
      id: "port-said-approach",
      purpose: "approach-flow",
      geometryVersion: "placeholder-0",
      geometryStatus: "placeholder",
      reviewOwner: null,
      coordinateReference: "EPSG:4326",
      // PLACEHOLDER: rough bounding box around the northern (Mediterranean) approach.
      geometry: { kind: "placeholder-bbox", minLat: 31.2, minLon: 32.1, maxLat: 31.6, maxLon: 32.6 },
      rationale: "Placeholder bounds marking the northern approach; awaiting reviewed geofence.",
    },
  ],
  supportedMetrics: ["vessel_count", "moving_fraction", "entry_count", "exit_count", "dwell_estimate"],
  limitations: [
    "AIS coverage does not represent every vessel",
    "geofence does not equal official canal authority boundaries",
    "geofence coordinates are placeholders pending review",
  ],
};

/** All supported chokepoints. The MVP set is exactly these three (§2.1). */
export const CHOKEPOINT_REGISTRY: readonly ChokepointProfile[] = [
  LONG_BEACH_APPROACH,
  SINGAPORE_MALACCA_APPROACH,
  SUEZ_CANAL_APPROACHES,
];

export function getChokepoint(id: string): ChokepointProfile | undefined {
  return CHOKEPOINT_REGISTRY.find((c) => c.id === id);
}
