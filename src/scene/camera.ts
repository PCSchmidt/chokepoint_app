/**
 * Camera framing (CHOKEPOINT-PLAN.md §4.1, §9.2 src/scene/camera.ts).
 *
 * Pure math: turn a geofence ring into a camera destination that frames the
 * fence with margin. Deterministic and node-testable; globe.ts converts the
 * result into a Cesium camera flight.
 */

import type { PolygonRing } from "../config/chokepoints";

export interface CameraFrame {
  latitude: number;
  longitude: number;
  /** Camera height in meters, chosen to fit the fence bbox with margin. */
  heightMeters: number;
  headingDegrees: number;
  /**
   * Top-down pitch. The destination IS the frame center: with an oblique
   * pitch the visible ground center lands ~height*tan(|pitch|) away from the
   * destination, which pushed fences off-screen (QA pick test caught it).
   * A top-down view guarantees the whole fence fits deterministically.
   */
  pitchDegrees: number;
}

const KM_PER_DEGREE_LAT = 111.32;
const MIN_HEIGHT_M = 8_000;
const MAX_HEIGHT_M = 3_000_000;

/** Camera height that fits a span, with padding for HUD rails (§4.2 cards). */
export function heightForSpanKm(spanKm: number, padding = 1.6): number {
  if (!(spanKm >= 0)) throw new Error("spanKm must be non-negative");
  return Math.round(Math.min(MAX_HEIGHT_M, Math.max(MIN_HEIGHT_M, spanKm * 1000 * padding)));
}

/**
 * Frame a fence: destination is the bbox centroid; height fits the larger
 * span (longitude scaled by cos(latitude)). Deterministic.
 */
export function frameForRing(ring: PolygonRing, padding = 1.6): CameraFrame {
  if (ring.length < 3) throw new Error("frameForRing requires a ring with >= 3 vertices");
  const lats = ring.map((v) => v[0]);
  const lons = ring.map((v) => v[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const spanLatKm = Math.abs(maxLat - minLat) * KM_PER_DEGREE_LAT;
  const spanLonKm = Math.abs(maxLon - minLon) * KM_PER_DEGREE_LAT * Math.cos((midLat * Math.PI) / 180);
  return {
    latitude: midLat,
    longitude: (minLon + maxLon) / 2,
    heightMeters: heightForSpanKm(Math.max(spanLatKm, spanLonKm), padding),
    headingDegrees: 0,
    pitchDegrees: -90,
  };
}
