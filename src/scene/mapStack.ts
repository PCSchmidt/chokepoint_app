/**
 * Keyless map stack (CHOKEPOINT-PLAN.md §4.1, §9.2 src/scene/mapStack.ts).
 *
 * The globe must work with NO credentials (§6.2, ADR-0003). This module is a
 * pure, Cesium-free registry of available base maps with their attribution
 * obligations; src/scene/globe.ts turns a descriptor into a real imagery
 * layer. Attribution is ALWAYS rendered (§9.3, §15) — each descriptor carries
 * its required credit.
 */

export interface MapStackDescriptor {
  id: string;
  label: string;
  /** True when the provider needs no key and no ion account (§6.2). */
  keyless: true;
  /** True when tiles come bundled (no connectivity needed). */
  offline: boolean;
  /** Required attribution text (always visible in the UI, §15). */
  attributionText: string;
  /** Non-null when tiles come from third-party servers with their own terms. */
  externalTermsNote: string | null;
}

/**
 * Ordered fallback stack: the offline option is FIRST so the app renders with
 * zero network and zero credentials (§6.2), richer tile servers are opt-in.
 */
export const MAP_STACKS: readonly MapStackDescriptor[] = [
  {
    id: "natural-earth-ii",
    label: "Natural Earth II (offline)",
    keyless: true,
    offline: true,
    attributionText: "Natural Earth II basemap (Cesium bundled data, public domain).",
    externalTermsNote: null,
  },
  {
    id: "esri-world-imagery",
    label: "Esri Satellite",
    keyless: true,
    offline: false,
    attributionText:
      "Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community.",
    externalTermsNote:
      "Esri governs the service and can change access; review current ArcGIS terms at scale (inspiration-repo precedent).",
  },
  {
    id: "osm-standard",
    label: "OpenStreetMap",
    keyless: true,
    offline: false,
    attributionText: "© OpenStreetMap contributors (ODbL 1.0).",
    externalTermsNote: "OSM tile usage policy applies; ODbL attribution is required.",
  },
] as const;

export type MapStackId = (typeof MAP_STACKS)[number]["id"];

export function getMapStack(id: string): MapStackDescriptor | undefined {
  return MAP_STACKS.find((m) => m.id === id);
}

/**
 * Default stack: keyless Esri World Imagery — the best readily-available
 * resolution without credentials (user decision 2026-09-09). The offline
 * Natural Earth II stack remains FIRST in the registry and is the automatic
 * fallback when there is no network: the app must still boot keyless AND
 * offline (§6.2); globe.ts falls back to the offline layer on tile failure.
 */
export const DEFAULT_MAP_STACK: MapStackId = "esri-world-imagery";

/** The offline fallback used when no network is available (§6.2). */
export const OFFLINE_FALLBACK_STACK: MapStackId = "natural-earth-ii";
