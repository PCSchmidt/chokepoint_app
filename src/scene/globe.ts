/**
 * Freight globe (CHOKEPOINT-PLAN.md §4.1, §9.1, ADR-0003; §9.2 src/scene/globe.ts).
 *
 * The ONLY module that touches the Cesium API. Keyless by construction:
 *  - No Cesium ion token is set and no ion assets are requested (§6.2);
 *  - the default base layer is the BUNDLED Natural Earth II imagery (offline),
 *    with keyless Esri/OSM stacks available via the map stack registry (§4.1);
 *  - requestRenderMode keeps idle GPU work at zero (§12.5 idle render budget).
 *
 * Node tests do not import this module (Cesium needs a browser); the pure
 * math it consumes lives in camera.ts / mapStack.ts / renderGovernor.ts.
 */

import * as Cesium from "cesium";

// Safety net for any import order: Cesium needs the base URL at runtime.
if (typeof window !== "undefined" && !window.CESIUM_BASE_URL) {
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium/";
}
import { frameForRing, type CameraFrame } from "./camera";
import { getMapStack, DEFAULT_MAP_STACK, type MapStackId } from "./mapStack";
import type { PolygonRing } from "../config/chokepoints";
import type { TransportObservation } from "../data/observation";

export interface FreightGlobe {
  viewer: Cesium.Viewer;
  /** Fly the camera to frame a fence ring (§4.1 camera framing). */
  frameRing(ring: PolygonRing, padding?: number): CameraFrame;
  /** Replace vessel points from canonical observations (SIMULATED-labeled data). */
  showObservations(observations: readonly TransportObservation[], selectedEntityId?: string | null): void;
  /** Draw reviewed fence outlines (always visible; they are the measurement region). */
  showFences(rings: ReadonlyArray<{ id: string; ring: PolygonRing; label: string }>): void;
  destroy(): void;
}

function viewerOptions(): Cesium.Viewer.ConstructorOptions {
  return {
    // Keyless stack: bundled offline imagery, no ion assets, no terrain service.
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"))
    ),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true, // §12.5: no idle render loop
    maximumRenderTimeChange: Infinity,
  };
}

export function createFreightGlobe(
  container: HTMLElement,
  mapStackId: MapStackId = DEFAULT_MAP_STACK,
): FreightGlobe {
  const descriptor = getMapStack(mapStackId);
  if (!descriptor) throw new Error(`unknown map stack: ${mapStackId}`);
  // The offline stack uses the bundled provider; external stacks swap the base
  // layer after viewer creation (keeps this module thin).
  const viewer = new Cesium.Viewer(container, viewerOptions());
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit(descriptor.attributionText));

  const applyExternal = (id: MapStackId): void => {
    if (id === "esri-world-imagery") {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          credit: getMapStack(id)?.attributionText ?? "",
        })
      );
    } else if (id === "osm-standard") {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          credit: getMapStack(id)?.attributionText ?? "© OpenStreetMap contributors",
        })
      );
    }
  };
  applyExternal(mapStackId);

  return {
    viewer,
    frameRing(ring, padding = 1.6) {
      const frame = frameForRing(ring, padding);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(frame.longitude, frame.latitude, frame.heightMeters),
        orientation: {
          heading: Cesium.Math.toRadians(frame.headingDegrees),
          pitch: Cesium.Math.toRadians(frame.pitchDegrees),
          roll: 0,
        },
      });
      return frame;
    },
    showObservations(observations, selectedEntityId) {
      viewer.entities.removeAll();
      for (const o of observations) {
        const selected = selectedEntityId !== undefined && o.entityId === selectedEntityId;
        viewer.entities.add({
          id: `${o.entityId}@${o.observedAt}`,
          position: Cesium.Cartesian3.fromDegrees(o.position.longitude, o.position.latitude),
          point: {
            pixelSize: selected ? 14 : 8,
            color: o.quality.classification === "confirmed" ? Cesium.Color.SKYBLUE : Cesium.Color.GRAY,
            outlineColor: selected ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString("#0a1522"),
            outlineWidth: 1,
          },
          description: `<table>
            <tr><td>entity</td><td>${o.entityId}</td></tr>
            <tr><td>observed</td><td>${o.observedAt}</td></tr>
            <tr><td>speed</td><td>${o.kinematics.speedKnots ?? "not available"} kn</td></tr>
            <tr><td>type</td><td>${o.entityType} (${o.quality.classification})</td></tr>
          </table>`,
        });
      }
      viewer.scene.requestRender();
    },
    showFences(rings) {
      for (const { id, ring } of rings) {
        viewer.entities.add({
          id: `fence-${id}`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.flatMap(([lat, lon]) => [lon, lat])),
            material: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.08),
            outline: true,
            outlineColor: Cesium.Color.SKYBLUE.withAlpha(0.6),
            height: 0,
          },
        });
      }
      viewer.scene.requestRender();
    },
    destroy() {
      viewer.destroy();
    },
  };
}
