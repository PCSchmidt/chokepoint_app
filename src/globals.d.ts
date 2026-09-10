/**
 * Global browser-environment declarations for Cesium's runtime config.
 * CesiumJS reads window.CESIUM_BASE_URL at runtime (see src/main.ts).
 */

interface Window {
  CESIUM_BASE_URL?: string;
}
