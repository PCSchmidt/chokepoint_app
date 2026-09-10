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
  /**
   * Visibility truth test (QA): project point entities to window coordinates
   * and drill-pick. An entity that picks at its own position IS rendered.
   */
  pickPointEntities(): {
    total: number;
    picked: number;
    sample: Array<{ id: string; windowX: number; windowY: number; pickedSelf: boolean }>;
  };
  destroy(): void;
}

function viewerOptions(): Cesium.Viewer.ConstructorOptions {
  return {
    // Start with NO base layer; the caller adds exactly one (keyless) layer.
    baseLayer: false,
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
    // QA reads pixels post-frame (samplePointPixels); production can keep
    // this off, but one extra buffer flag is cheaper than a render hook.
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
  };
}

/**
 * Exactly ONE base layer, chosen by the stack id. Esri/OSM tile errors (no
 * network, provider outage) fall back to the bundled offline Natural Earth II
 * layer so the globe still renders keyless/offline (§6.2).
 */
function baseLayerFor(id: MapStackId): Cesium.ImageryProvider {
  if (id === "esri-world-imagery") {
    return new Cesium.UrlTemplateImageryProvider({
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      credit: getMapStack(id)?.attributionText ?? "",
      maximumLevel: 19,
    });
  }
  if (id === "osm-standard") {
    return new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      credit: getMapStack(id)?.attributionText ?? "© OpenStreetMap contributors",
      maximumLevel: 19,
    });
  }
  // Offline bundled imagery (Natural Earth II).
  return Cesium.TileMapServiceImageryProvider.fromUrl(
    Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")
  ) as unknown as Cesium.TileMapServiceImageryProvider;
}

export function createFreightGlobe(
  container: HTMLElement,
  mapStackId: MapStackId = DEFAULT_MAP_STACK,
): FreightGlobe {
  const descriptor = getMapStack(mapStackId);
  if (!descriptor) throw new Error(`unknown map stack: ${mapStackId}`);
  const viewer = new Cesium.Viewer(container, {
    ...(viewerOptions() as Cesium.Viewer.ConstructorOptions),
    baseLayer: new Cesium.ImageryLayer(baseLayerFor(mapStackId)),
  });
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit(descriptor.attributionText));

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
      // Remove only POINT entities; fence polygons must survive (§4.1: fences
      // stay visible; the earlier removeAll() wiped them each frame).
      const toRemove = viewer.entities.values.filter((e) => typeof e.id === "string" && e.id.includes("@"));
      for (const entity of toRemove) viewer.entities.remove(entity);
      for (const o of observations) {
        const selected = selectedEntityId !== undefined && o.entityId === selectedEntityId;
        const isAir = o.mode === "air";
        // §9.3 visual direction: sea blue for maritime, amber for air. Air
        // points render AT ALTITUDE (aircraft are airborne); maritime points
        // stay ground-clamped.
        const color = isAir
          ? Cesium.Color.fromCssColorString("#f59e0b")
          : o.quality.classification === "confirmed"
            ? Cesium.Color.fromCssColorString("#38bdf8")
            : Cesium.Color.fromCssColorString("#94a3b8");
        viewer.entities.add({
          id: `${o.entityId}@${o.observedAt}`,
          position: Cesium.Cartesian3.fromDegrees(
            o.position.longitude,
            o.position.latitude,
            isAir ? (o.position.altitudeMeters ?? 0) : undefined,
          ),
          point: {
            pixelSize: selected ? 18 : 12,
            color,
            outlineColor: selected ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString("#04121f"),
            outlineWidth: 2,
            // Height reference keeps maritime points readable over the surface;
            // air points carry real altitude and must not clamp.
            heightReference: isAir ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
    pickPointEntities() {
      const scene = viewer.scene;
      const pointEntities = viewer.entities.values.filter((e) => e.point && e.position);
      let pickedCount = 0;
      const sample: Array<{ id: string; windowX: number; windowY: number; pickedSelf: boolean }> = [];
      for (const entity of pointEntities) {
        const clockTime = viewer.clock.currentTime;
        const cartesian = entity.position!.getValue(clockTime);
        if (!cartesian) continue;
        const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cartesian);
        if (!windowPos) continue;
        const pickedObjects = scene.drillPick(windowPos, 3);
        const pickedSelf = pickedObjects.some((p) => p?.id !== undefined && String(p.id) === String(entity.id));
        if (pickedSelf) pickedCount += 1;
        if (sample.length < 3) {
          sample.push({
            id: String(entity.id),
            windowX: Math.round(windowPos.x),
            windowY: Math.round(windowPos.y),
            pickedSelf,
          });
        }
      }
      return { total: pointEntities.length, picked: pickedCount, sample };
    },

    showFences(rings) {
      for (const { id, ring } of rings) {
        const positions = Cesium.Cartesian3.fromDegreesArray(ring.flatMap(([lat, lon]) => [lon, lat]));
        // Faint fill (fill alpha is kept low; Cesium surface-polygon OUTLINES
        // are unsupported in most browsers, so the boundary is drawn as a
        // separate polyline entity instead — always visible).
        viewer.entities.add({
          id: `fence-${id}`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.06),
            height: 0,
          },
        });
        viewer.entities.add({
          id: `fence-line-${id}`,
          polyline: {
            positions: [...positions, positions[0]!],
            width: 2,
            material: Cesium.Color.fromCssColorString("#7dd3fc"),
            clampToGround: false,
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
