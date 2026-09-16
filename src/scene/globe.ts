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
import { frameForRing, frameForPoints, type CameraFrame, type GeoPoint } from "./camera";
import { drawNodeSprite, pulsePixelSize, rotatePattern } from "./nodeEffects";
import { getMapStack, DEFAULT_MAP_STACK, type MapStackId } from "./mapStack";
import type { PolygonRing } from "../config/chokepoints";
import type { RouteArc } from "../config/routes";
import type { TransportObservation } from "../data/observation";

/** A chokepoint's network-node presentation state (main.ts computes; globe draws). */
export interface NodeMarker {
  id: string;
  name: string;
  anchor: [number, number];
  /** Headline line, e.g. "11 vessels" or "12 min wait". */
  headline: string;
  /** §9.3 badge vocabulary; drives sprite border color. */
  badge: string;
  /** Waiting-cohort size; > 0 enables the pulse ring (P4). */
  cohort: number;
}

export interface FreightGlobe {
  viewer: Cesium.Viewer;
  /** Fly the camera to frame a fence ring (§4.1 camera framing). */
  frameRing(ring: PolygonRing, padding?: number): CameraFrame;
  /** Replace vessel points from canonical observations (SIMULATED-labeled data). */
  showObservations(observations: readonly TransportObservation[], selectedEntityId?: string | null): void;
  /** Draw reviewed fence outlines (always visible; they are the measurement region). */
  showFences(rings: ReadonlyArray<{ id: string; ring: PolygonRing; label: string }>): void;
  /**
   * Draw illustrative corridor arcs (NETWORK-VIEW-PLAN.md Phase 1): dashed
   * geodesic polylines, one per declared leg. A UI AFFORDANCE, not a claim —
   * each arc tooltip states "illustrative corridor, not a tracked vessel
   * path". Callers pass fully-formed ids; ids must NOT contain "@" (the
   * observation-removal heuristic keys on it).
   */
  showRoutes(arcs: ReadonlyArray<RouteArc>): void;
  /**
   * Idempotent overlay clear: removes fence and route entities by id prefix,
   * leaving observation point entities (ids contain "@") untouched. Called
   * before any fence/route redraw so overlays never accumulate.
   */
  clearOverlays(): void;
  /** Frame a set of points (the network view landing frame). */
  frameAll(points: readonly GeoPoint[], padding?: number): CameraFrame;
  /**
   * Cinematic boot (NETWORK-VIEW-PLAN.md Phase 1.5 P1): set the camera high
   * above the network, then one fixed-duration settle flight to the working
   * frame. Deterministic durations; no wall clock in the DATA path (§12.5) —
   * this only moves the CAMERA at boot.
   */
  bootFlyIn(points: readonly GeoPoint[]): CameraFrame;
  /**
   * Node status markers (Phase 1.5 P2): one labeled billboard per chokepoint,
   * colored by its §9.3 badge, plus a dwell-cohort pulse (P4). Replaces prior
   * node entities (ids prefixed "node-"/"pulse-", never containing "@").
   */
  showNodeMarkers(markers: ReadonlyArray<NodeMarker>): void;
  /** Click callback for node markers (transactional: fires only on pick). */
  onNodeClick(handler: ((chokepointId: string) => void) | null): void;
  /**
   * Corridor flow animation (P3): the arcs' dash pattern advances with the
   * viewer clock — which only advances on actual renders under
   * requestRenderMode, so arcs "flow" during replay/scrub and freeze when
   * idle. active=false renders a static dash.
   */
  setRouteFlow(active: boolean): void;
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

  // Route-flow state (P3): active during replay; the dash pattern advances
  // with the viewer clock (renders happen only on request under
  // requestRenderMode, so the flow is render-driven, never wall-clock-driven).
  let routeFlowActive = false;
  let flowOffset = 0;
  let lastFlowSeconds: number | null = null;
  // Node click handler (P2): transactional pick -> callback (§8.6).
  let nodeClickHandler: ((chokepointId: string) => void) | null = null;
  const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    if (!nodeClickHandler) return;
    const picked = viewer.scene.drillPick(click.position, 3);
    for (const p of picked) {
      const id = p?.id !== undefined ? String(p.id) : "";
      if (id.startsWith("node-")) {
        nodeClickHandler(id.slice("node-".length));
        return;
      }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

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

    frameAll(points, padding = 1.15) {
      const frame = frameForPoints(points, padding);
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

    bootFlyIn(points) {
      const frame = frameForPoints(points, 1.15);
      const orientation = {
        heading: Cesium.Math.toRadians(frame.headingDegrees),
        pitch: Cesium.Math.toRadians(frame.pitchDegrees),
        roll: 0,
      };
      // Start altitude: 1.6x the working frame, capped well below orbital
      // distances — higher starts overflow Cesium's frustum-array math
      // (RangeError in updateFrustums) when the network spans the globe.
      const bootHeight = Math.min(frame.heightMeters * 1.6, 2_000_000);
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(frame.longitude, frame.latitude, bootHeight),
        orientation,
      });
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(frame.longitude, frame.latitude, frame.heightMeters),
        orientation,
        duration: 2.5,
      });
      return frame;
    },

    showNodeMarkers(markers) {
      // Replace node + pulse entities; idempotent (prefix-based, never "@").
      const toRemove = viewer.entities.values.filter(
        (e) =>
          typeof e.id === "string" &&
          (e.id.startsWith("node-") || e.id.startsWith("pulse-")),
      );
      for (const entity of toRemove) viewer.entities.remove(entity);
      // P4 pulse for one marker (local helper so the pulses-only bisect mode
      // can draw pulses WITHOUT node billboards).
      const addPulse = (m: NodeMarker): void => {
        if (m.cohort === 0) return;
        const animated = m.cohort > 0;
        const cohort = Math.abs(m.cohort);
        const pixelSize = animated
          ? new Cesium.CallbackProperty(
              (time) => pulsePixelSize(cohort, time ?? viewer.clock.currentTime),
              false,
            )
          : 22;
        viewer.entities.add({
          id: `pulse-${m.id}`,
          position: Cesium.Cartesian3.fromDegrees(m.anchor[1], m.anchor[0], 0),
          point: {
            pixelSize,
            color: Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.28),
            outlineWidth: 0,
            heightReference: Cesium.HeightReference.NONE,
          },
        });
      };
      for (const m of markers) {
        viewer.entities.add({
          id: `node-${m.id}`,
          position: Cesium.Cartesian3.fromDegrees(m.anchor[1], m.anchor[0], 0),
          // P2: labeled status sprite — canvas-drawn, no new deps.
          billboard: {
            image: drawNodeSprite(m),
            scale: 1,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            sizeInMeters: false,
          },
        });
        addPulse(m);
      }
      viewer.scene.requestRender();
    },

    onNodeClick(handler) {
      nodeClickHandler = handler;
    },

    setRouteFlow(active) {
      routeFlowActive = active;
      viewer.scene.requestRender();
    },

    showRoutes(arcs: ReadonlyArray<RouteArc>) {
      for (const arc of arcs) {
        const arcPositions: Cesium.Cartesian3[] = Cesium.Cartesian3.fromDegreesArray([
          arc.from[1],
          arc.from[0],
          arc.to[1],
          arc.to[0],
        ]);
        const dashMaterial = new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#f59e0b").withAlpha(0.55),
          dashLength: 16,
          // P3: the dash runner advances ONLY while flow is active and only
          // from viewer-clock deltas — under requestRenderMode this means the
          // corridor "flows" during replay/scrub renders and freezes when
          // idle (§12.5: no wall clock in the render path).
          dashPattern: new Cesium.CallbackProperty((time) => {
            // Cesium JulianDate exposes dayNumber + secondsOfDay. The
            // previously-assumed `julianDateNumber` is undefined on real
            // JulianDates -> NaN seconds -> zeroed dash pattern; same latent
            // bug as the P4 pulse crash (see STATUS.md).
            const t = (time ?? viewer.clock.currentTime) as unknown as {
              dayNumber: number;
              secondsOfDay: number;
            };
            const seconds = t.dayNumber * 86400 + t.secondsOfDay;
            if (routeFlowActive) {
              if (lastFlowSeconds !== null) {
                flowOffset = (flowOffset + Math.max(0, seconds - lastFlowSeconds)) % 16;
              }
            }
            lastFlowSeconds = seconds;
            return rotatePattern(0x00ff, Math.floor(flowOffset));
          }, false),
        });
        viewer.entities.add({
          id: `route-${arc.id}`,
          // Affordance label, not a claim: the arc is illustrative corridor
          // art between reviewed fence anchors (§3.1 — never a DERIVED badge).
          // description lives on the ENTITY (PolylineGraphics options have no
          // description field — nesting it there breaks TS union resolution).
          description: `<table>
            <tr><td>corridor</td><td>${arc.fromId} ↔ ${arc.toId}</td></tr>
            <tr><td>note</td><td>illustrative corridor — NOT a tracked vessel path</td></tr>
          </table>`,
          polyline: {
            positions: arcPositions,
            width: 1.5,
            material: dashMaterial,
            clampToGround: false,
          },
        });
      }
      viewer.scene.requestRender();
    },

    clearOverlays() {
      const toRemove = viewer.entities.values.filter(
        (e) =>
          typeof e.id === "string" &&
          (e.id.startsWith("fence-") ||
            e.id.startsWith("route-") ||
            e.id.startsWith("node-") ||
            e.id.startsWith("pulse-")),
      );
      for (const entity of toRemove) viewer.entities.remove(entity);
      viewer.scene.requestRender();
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
      clickHandler.destroy();
      viewer.destroy();
    },
  };
}
