/**
 * Chokepoint application entry (CHOKEPOINT-PLAN.md §9.2, §9.3; NETWORK-VIEW-PLAN.md
 * Phase 1 step 6).
 *
 * Working application, not a marketing hero: NETWORK VIEW (all profiles on one
 * globe + compare table + corridor arcs) -> focus (freight HUD + event cards +
 * timeline + evidence drawer). The mission launcher screen is gone; the
 * compare table replaces it. Fixture mode by default; the SIM badge is visible
 * whenever simulated data is shown (§3.1). Attribution is always rendered
 * (§9.3, §15). Share state is the URL hash only (§11.1/§11.2 — no secrets).
 */

// Cesium reads window.CESIUM_BASE_URL at RUNTIME (the Vite `define` only
// rewrites bare identifiers — it does not set the window property). Without
// this, the viewer cannot load its workers/imagery and render fails.
window.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;

// PWA: register the offline shell service worker (production builds only;
// dev needs uncached source). Registration is failure-tolerant: the app is
// fully usable without it.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline shell unavailable — the app still works online.
    });
  });
}

import * as Cesium from "cesium";
import "./styles.css";
import { startup } from "./app/startup";
import { shareUrl } from "./app/shareState";
import { createFreightGlobe, type FreightGlobe, type NodeMarker } from "./scene/globe";
import { renderFreightHud } from "./ui/freightHud";
import { renderEventCards } from "./overlays/eventCards";
import { renderEvidenceDrawer } from "./ui/evidenceDrawer";
import { renderWatchlistSaveForm, renderWatchlistPanel, type WatchlistSaveSelection } from "./ui/watchlist";
import { renderAgentPanel, renderAgentAnswer, type AgentAnswerView } from "./ui/agentPanel";
import { renderVoicePanel, setVoiceListening } from "./ui/voicePanel";
import { askAgent } from "./agent/pipeline";
import { detectVoiceAvailability, runVoiceTurn, speakableAnswer, type SpeechRecognitionLike } from "./agent/voiceSession";
import { resolveWindow } from "./agent/intent";
import type { UiAction } from "./agent/tools";
import {
  loadWatchlist,
  saveWatchlist,
  upsertWatchEntry,
  removeWatchEntry,
  evaluateWatchlist,
  watchEntryId,
  type WatchlistEntry,
} from "./app/watchlist";
import { TimelineController, replayWindow } from "./ui/timeline";
import {
  compareRows,
  networkObservations,
  renderCompareTable,
  headlineSeries,
  type CompareSort,
} from "./ui/compareTable";
import { resolveRouteArcs, primaryFence, centroidOfRing } from "./config/routes";
import { buildStorySteps, renderStoryBar, type StoryStep } from "./ui/storyMode";
import type { ChokepointSnapshot } from "./data/manager";
import type { AppStateSnapshot } from "./app/appState";
import type { PolygonRing } from "./config/chokepoints";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app container missing");

let globe: FreightGlobe | null = null;
let shownFocusId: string | null = null;
let timeline: TimelineController | null = null;
let replayTick: number | null = null;
let compareSort: CompareSort = "anomaly";
// Watchlist (Workflow E): local-first persistence; evaluated from data only.
let watchEntries: WatchlistEntry[] = loadWatchlist(window.localStorage);

// --- diagnostic helpers (QA only) ---
function viewer_clock(g: NonNullable<FreightGlobe>): import("cesium").JulianDate {
  return g.viewer.clock.currentTime;
}
function samplePixel(gl: WebGLRenderingContext | null, canvas: HTMLCanvasElement, x: number, y: number): [number, number, number, number] | null {
  if (!gl) return null;
  const px = new Uint8Array(4);
  // y is in CSS pixels; the drawing buffer may differ — use gl.readPixels with
  // y flipped to buffer coordinates.
  const dpr = canvas.width / canvas.clientWidth;
  const bx = Math.round(x * dpr);
  const by = Math.round(canvas.height - y * dpr);
  gl.readPixels(bx, by, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0]!, px[1]!, px[2]!, px[3]!];
}

// Test/diagnostic hook (QA reads entity counts; contains no secrets).
(window as unknown as { __chokepointDebug?: unknown }).__chokepointDebug = {
  getEntityCount: () => (globe ? globe.viewer.entities.values.length : -1),
  /** QA diagnostic: camera pose + frustum near/far at read time. */
  getCameraState: () => {
    if (!globe) return null;
    const cam = globe.viewer.camera;
    const f = cam.frustum as unknown as { near?: number; far?: number };
    return {
      position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      direction: { x: cam.direction.x, y: cam.direction.y, z: cam.direction.z },
      near: f.near ?? null,
      far: f.far ?? null,
    };
  },
  getEntityKinds: () =>
    globe
      ? globe.viewer.entities.values.map((e) => ({
          id: String(e.id),
          hasPoint: !!e.point,
          hasPolygon: !!e.polygon,
        }))
      : [],
  pickPointEntities: () => (globe ? globe.pickPointEntities() : { total: 0, picked: 0, sample: [] }),
  /**
   * Canvas pixel sampling at a point's projected position: does the vessel
   * point color appear there? This bypasses pick entirely.
   */
  samplePointPixels: () => {
    if (!globe) return { total: 0, onCanvas: 0, colorHits: 0, sample: [] };
    const scene = globe.viewer.scene;
    const canvas = scene.canvas;
    const pointEntities = globe.viewer.entities.values.filter((e) => e.point && e.position);
    let colorHits = 0;
    const sample: Array<{ id: string; windowX: number; windowY: number; rgba: number[] | null }> = [];
    for (const entity of pointEntities) {
      const cartesian = entity.position!.getValue(viewer_clock(globe));
      if (!cartesian) continue;
      const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(scene, cartesian);
      if (!windowPos) continue;
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const x = Math.round(windowPos.x);
      const y = Math.round(windowPos.y);
      const px = samplePixel(gl, canvas, x, y);
      // Point color #38bdf8 = rgb(56,189,248); allow tolerance.
      const isSeaBlue = px && Math.abs(px[0] - 56) < 40 && Math.abs(px[1] - 189) < 40 && Math.abs(px[2] - 248) < 40;
      if (isSeaBlue) colorHits += 1;
      if (sample.length < 3) sample.push({ id: String(entity.id), windowX: x, windowY: y, rgba: px ?? null });
    }
    return { total: pointEntities.length, colorHits, sample };
  },
  /**
   * Render-cost instrumentation (§12.5 replay frame budget): preRender ->
   * postRender wall deltas, counted by the perf script. Contains no secrets.
   */
  startRenderStats: () => {
    if (!globe) return false;
    const scene = globe.viewer.scene;
    const stats = { pre: 0, samples: [] as number[], lastRenderAt: 0 };
    const removePre = scene.preRender.addEventListener(() => {
      stats.pre = performance.now();
    });
    const removePost = scene.postRender.addEventListener(() => {
      if (stats.pre > 0) stats.samples.push(performance.now() - stats.pre);
      stats.pre = 0;
      stats.lastRenderAt = performance.now();
    });
    (window as unknown as { __chokepointRenderStats?: typeof stats }).__chokepointRenderStats = stats;
    (window as unknown as { __chokepointRenderCleanup?: (() => void)[] }).__chokepointRenderCleanup = [removePre, removePost];
    return true;
  },
  getRenderStats: () => {
    const stats = (window as unknown as { __chokepointRenderStats?: { samples: number[] } }).__chokepointRenderStats;
    if (!stats) return null;
    const s = [...stats.samples].sort((a, b) => a - b);
    const n = s.length;
    return {
      renderCount: n,
      meanMs: n ? s.reduce((a, b) => a + b, 0) / n : 0,
      maxMs: n ? s[n - 1]! : 0,
      p95Ms: n ? s[Math.min(n - 1, Math.floor(n * 0.95))]! : 0,
    };
  },
  /**
   * Scrub latency measurement (§12.5 timeline scrubbing): dispatch a seek,
   * poll the render stats on the page's own event loop, resolve with the
   * dispatch -> completed-render latency in ms (-1 when instrumentation is
   * missing). Lives here because a page.evaluate callback cannot rely on
   * Node-side transform helpers.
   */
  measureScrubLatency: (index: number, n: number) => {
    return new Promise<number>((resolve) => {
      const input = document.querySelector<HTMLInputElement>("[data-testid=seek]");
      const stats = (window as unknown as { __chokepointRenderStats?: { samples: number[] } }).__chokepointRenderStats;
      if (!input || !stats) return resolve(-1);
      const min = Number(input.min);
      const max = Number(input.max);
      const target = min + ((max - min) * (index + 1)) / (n + 1);
      const before = stats.samples.length;
      const t0 = performance.now();
      input.value = String(target);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const check = (): void => {
        if (stats.samples.length > before) return resolve(performance.now() - t0);
        if (performance.now() - t0 > 2000) return resolve(2000); // timeout = miss
        window.setTimeout(check, 5);
      };
      window.setTimeout(check, 5);
    });
  },
  getHeap: () => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? mem.usedJSHeapSize : null;
  },
  getNodeSpriteInfo: () => {
    if (!globe) return null;
    return globe.viewer.entities.values
      .filter((e) => typeof e.id === "string" && e.id.startsWith("node-"))
      .map((e) => {
        const img = e.billboard?.image?.getValue(viewer_clock(globe!));
        return {
          id: String(e.id),
          type: typeof img,
          isCanvas: img instanceof HTMLCanvasElement,
          width: (img as HTMLCanvasElement | undefined)?.width ?? null,
          height: (img as HTMLCanvasElement | undefined)?.height ?? null,
        };
      });
  },
  inspectBillboards: () => {
    if (!globe) return null;
    const out: Array<Record<string, unknown>> = [];
    const prims = Array.from(
      globe.viewer.scene.primitives as unknown as Iterable<Record<string, unknown>>,
    );
    for (const p of prims) {
      const billboards = (p as { billboards?: Array<Record<string, unknown>> })?.billboards;
      if (Array.isArray(billboards)) {
        for (const b of billboards) {
          out.push({
            id: String(b.id ?? ""),
            imageType: typeof b.image,
            width: (b.image as HTMLCanvasElement | undefined)?.width ?? null,
            height: (b.image as HTMLCanvasElement | undefined)?.height ?? null,
            ready: b.ready,
            show: b.show,
          });
        }
      }
    }
    return out;
  },
  testCanvas: () => {
    const c = document.createElement("canvas");
    c.width = 148;
    c.height = 44;
    return { w: c.width, h: c.height, ctx: !!c.getContext("2d") };
  },
  getCamera: () => {
    if (!globe) return null;
    const carto = globe.viewer.camera.positionCartographic;
    return {
      latitude: Number((carto.latitude * 180) / Math.PI),
      longitude: Number((carto.longitude * 180) / Math.PI),
      height: Math.round(carto.height),
    };
  },
};

// --- Boot: fixture mode; the Phase 5 API will supply live data (§16.1) ---
// Checked-in SIMULATED fixtures travel with the bundle (small, provenance-
// labeled); the manager never touches node:fs in the browser.
const fixtureModules = import.meta.glob("./../tests/fixtures/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const fixtureManifests = Object.values(fixtureModules) as import("./data/fixtureLoader").FixtureManifest[];

const shareHash = window.location.hash.length > 1 ? window.location.hash : undefined;
const { state, manager } = await startup({ mode: "fixture", manifests: fixtureManifests, shareHash });

root.innerHTML = `
  <header class="app-header">
    <div class="app-title">
      <h1>Chokepoint</h1>
      <span class="app-subtitle">Provenance-aware transportation intelligence</span>
    </div>
  </header>
  <main id="view-root"></main>
  <footer class="attribution-bar" data-testid="attribution-bar">
    <span id="attribution-text" data-testid="attribution-text"></span>
    <a id="feedback-link" data-testid="feedback-link" href="https://github.com/PCSchmidt/chokepoint_app/discussions" target="_blank" rel="noopener noreferrer">Feedback</a>
  </footer>
`;

const viewRoot = document.querySelector<HTMLDivElement>("#view-root")!;
const attributionText = document.querySelector<HTMLSpanElement>("#attribution-text")!;

/** Function-bound access keeps TS from over-narrowing the module-level globe. */
function getGlobe(): FreightGlobe | null {
  return globe;
}

function required(selector: string): HTMLElement {
  const el = viewRoot.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}

function reviewedRings(chokepointId: string): Array<{ id: string; ring: PolygonRing }> {
  const profile = manager.listChokepoints().find((c) => c.id === chokepointId);
  if (!profile) return [];
  return profile.geofences
    .filter((g) => g.geometryStatus === "reviewed" && g.geometry.kind === "polygon")
    .map((g) => (g.geometry.kind === "polygon" ? { id: g.id, ring: g.geometry.ring } : null))
    .filter((r): r is { id: string; ring: PolygonRing } => r !== null);
}

// ------------------------------------------------------------ network scene

/**
 * Fence entities for ALL profiles at once. Fence ids are prefixed with the
 * profile id (`profile.id:fence.id`) so per-profile removal stays possible as
 * the registry grows. HARD RULE: no entity id may contain "@" —
 * globe.showObservations removes entities by that substring (observation ids
 * embed `entityId@observedAt`), so a "@" here would get fences/arcs wiped on
 * every refresh (NETWORK-VIEW-PLAN.md constraint).
 */
function allFences(): Array<{ id: string; ring: PolygonRing; label: string }> {
  const fences: Array<{ id: string; ring: PolygonRing; label: string }> = [];
  for (const profile of manager.listChokepoints()) {
    for (const r of reviewedRings(profile.id)) {
      fences.push({ id: `${profile.id}:${r.id}`, ring: r.ring, label: `${profile.name} — ${r.id}` });
    }
  }
  return fences;
}

/**
 * One anchor [lat, lon] per profile: the centroid of the SAME primary fence
 * the focus camera frames (config/routes.primaryFence pins the rule), so
 * nodes, arcs, and focus framing always agree.
 */
function nodeAnchors(): Array<{ id: string; name: string; anchor: [number, number] }> {
  return manager
    .listChokepoints()
    .map((p) => {
      const fence = primaryFence(p);
      return fence.geometry.kind === "polygon"
        ? { id: p.id, name: p.name, anchor: centroidOfRing(fence.geometry.ring) }
        : null;
    })
    .filter((n): n is { id: string; name: string; anchor: [number, number] } => n !== null);
}

/**
 * Agent turn (§8): question -> deterministic tools -> evidence bundle ->
 * evaluator -> caveated answer. The wall clock is not read: the window is
 * the current investigation state. On the network view (focus null) the
 * context scope is null and the intent parser resolves a NAMED chokepoint
 * from the question — the agent never guesses a scope (§8.2).
 */
async function handleAgentQuestion(question: string): Promise<void> {
  const snapshot = state.get();
  const answerEl = required("#agent");
  const { answer, uiAction } = await askAgent(question, manager, {
    chokepointId: snapshot.focusChokepointId,
    window: snapshot.timeWindow,
  });
  let appliedNote: string | null = null;
  if (uiAction) {
    const outcome = applyAgentAction(uiAction);
    appliedNote = outcome ? "Applied to the current view." : "Not applied — no chokepoint is in focus.";
  }
  renderAgentAnswer(answerEl, {
    text: appliedNote ? `${answer.text} ${appliedNote}` : answer.text,
    caveats: answer.caveats,
    rejected: answer.rejected,
    evidenceRefs: answer.evidenceRefs,
    verdict: answer.verdict,
  } satisfies AgentAnswerView);
}

/**
 * Apply a validated §4.4 UI action through app state (§8.6: camera/layer
 * ownership is separate from analytical results; a response may claim success
 * only when the state update was actually issued).
 */
function applyAgentAction(action: UiAction): boolean {
  const snapshot = state.get();
  switch (action.action) {
    case "focus_chokepoint": {
      const window = manager.defaultWindow();
      state.update({
        focusChokepointId: action.chokepointId,
        timeWindow: window,
        replay: { cursor: window.endAt, playing: false },
      });
      return true;
    }
    case "set_time_window": {
      if (!snapshot.timeWindow) return false;
      const resolved = resolveWindow(action.window, snapshot.timeWindow.endAt, manager.defaultWindow());
      state.update({ timeWindow: resolved, replay: { cursor: resolved.endAt, playing: false } });
      return true;
    }
    case "start_replay": {
      if (!snapshot.timeWindow) return false;
      // Starting at the window end would auto-pause immediately (advance
      // clamps at the end): restart from the window start in that case.
      const atEnd =
        snapshot.replay.cursor !== null && snapshot.replay.cursor >= snapshot.timeWindow.endAt;
      state.update({
        replay: {
          playing: true,
          ...(atEnd ? { cursor: snapshot.timeWindow.startAt } : {}),
        },
      });
      return true;
    }
    case "stop_replay":
      state.update({ replay: { playing: false } });
      return true;
  }
}

function persistWatchlist(): void {
  saveWatchlist(watchEntries, window.localStorage);
}

function addWatch(selection: WatchlistSaveSelection): void {
  const chokepointId = state.get().focusChokepointId;
  if (!chokepointId) return;
  const profile = manager.listChokepoints().find((c) => c.id === chokepointId);
  if (!profile) return;
  const entry: WatchlistEntry = {
    id: watchEntryId({
      chokepointId,
      fenceIds: profile.geofences.map((g) => g.id),
      metricId: selection.metricId,
      direction: selection.direction,
      relativePctThreshold: selection.relativePctThreshold,
      freshnessPolicy: selection.freshnessPolicy,
      configVersion: profile.configVersion,
    }),
    chokepointId,
    fenceIds: profile.geofences.map((g) => g.id),
    metricId: selection.metricId,
    direction: selection.direction,
    relativePctThreshold: selection.relativePctThreshold,
    freshnessPolicy: selection.freshnessPolicy,
    createdAt: new Date().toISOString(),
    configVersion: profile.configVersion,
  };
  watchEntries = upsertWatchEntry(watchEntries, entry);
  persistWatchlist();
}

// ---------------------------------------------------------- network shell

function mountNetworkShell(): void {
  viewRoot.innerHTML = `
    <div class="network">
      <aside class="left-rail">
        <div id="compare" class="compare-slot"></div>
        <div id="watchlist" class="watchlist"></div>
        <div id="agent" class="agent-slot"></div>
        <div id="voice" class="voice-slot"></div>
      </aside>
      <main class="globe-pane">
        <div id="globe"></div>
        <button id="story-start" data-testid="story-start" class="story-start" title="Guided tour of the network">▶ Guided story</button>
        <div class="legend" data-testid="legend" aria-hidden="false">
          <span class="legend-item"><span class="legend-swatch legend-fence"></span>Reviewed geofence</span>
          <span class="legend-item"><span class="legend-swatch legend-arc"></span>Illustrative corridor (not a tracked path)</span>
          <span class="legend-item"><span class="legend-swatch legend-pulse"></span>Waiting cohort</span>
          <span class="legend-item legend-note">All data SIMULATED (SIM)</span>
        </div>
        <div id="story-bar-slot" class="story-bar-slot"></div>
        <div id="timeline" class="timeline"></div>
        <div id="share" class="share"></div>
      </main>
      <aside class="right-rail">
        <div id="focus-panel" class="focus-panel"></div>
      </aside>
    </div>
  `;
  globe = createFreightGlobe(required("#globe"));
  // P2: globe nodes are first-class navigation — click = focus (§8.6: the
  // state update is the transaction; the camera move follows from state).
  globe.onNodeClick((chokepointId) => {
    state.update({ focusChokepointId: chokepointId });
  });
  required("#story-start").addEventListener("click", startStory);
  // The agent panel is rendered ONCE at mount so its details elements keep
  // their open state across replay ticks.
  renderAgentPanel(required("#agent"), (question) => {
    void handleAgentQuestion(question);
  });
  mountVoicePanel();
}

/**
 * One-time scene population: every profile's fences (prefixed ids) + the
 * declared illustrative corridors. Fences and arcs are drawn ONCE per mount;
 * focus changes never re-call showFences (NETWORK-VIEW-PLAN.md step 6).
 * clearOverlays() first makes the draw idempotent — re-mounts cannot
 * accumulate stale fence entities (fixes a pre-existing accumulation bug on
 * agent focus_chokepoint while an investigation is open).
 */
function renderNetworkScene(): void {
  if (!globe) return;
  globe.clearOverlays();
  globe.showFences(allFences());
  globe.showRoutes(resolveRouteArcs());
}

// ------------------------------------------------------ focus (right rail)

/**
 * The right rail: focus panel when a row/node is selected, an honest hint
 * otherwise. All renders reuse the existing freightHud / eventCards /
 * evidenceDrawer functions unchanged (NETWORK-VIEW-PLAN.md step 6).
 */
function renderFocusPanel(snapshot: AppStateSnapshot): void {
  const panel = required("#focus-panel");
  if (!snapshot.focusChokepointId) {
    panel.innerHTML = `
      <div class="focus-hint" data-testid="focus-hint">
        <h3>Network view</h3>
        <p>Five chokepoints, one system. Select a row in the compare table — or a node on the globe — to open its investigation. Corridor arcs are illustrative, not tracked vessel paths.</p>
      </div>
    `;
    return;
  }
  panel.innerHTML = `
    <button id="clear-focus" data-testid="clear-focus">← All chokepoints</button>
    <div id="watch-save" class="watch-save-slot"></div>
    <div id="hud" class="hud"></div>
    <div id="event-cards" class="event-cards"></div>
    <div id="evidence" class="evidence"></div>
  `;
  required("#clear-focus").addEventListener("click", () => {
    state.update({ focusChokepointId: null });
  });
  const profile = manager.listChokepoints().find((c) => c.id === snapshot.focusChokepointId);
  renderWatchlistSaveForm(required("#watch-save"), profile?.name ?? "chokepoint", addWatch);
}

function focusSnapshotFor(
  snapshot: AppStateSnapshot,
  snaps: readonly ChokepointSnapshot[],
): ChokepointSnapshot | null {
  if (!snapshot.focusChokepointId) return null;
  return snaps.find((s) => s.profile.id === snapshot.focusChokepointId) ?? null;
}

// ------------------------------------------------------- voice (§8.6 keyless)

/**
 * Browser speech surfaces, narrowed to the session contract. Detection is
 * honest: unsupported browsers render UNAVAILABLE (never a silent control).
 * WebKit-prefixed constructors included — Chrome exposes webkitSpeechRecognition.
 */
function browserSpeech(): {
  recognition: SpeechRecognitionLike | null;
  synthesis: { speak(u: { text: string; onend?: () => void }): void; cancel(): void } | null;
} {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    speechSynthesis?: { speak(u: { text: string; onend?: () => void }): void; cancel(): void };
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  return {
    recognition: Ctor ? new Ctor() : null,
    synthesis: w.speechSynthesis ?? null,
  };
}

let voiceRecognition: SpeechRecognitionLike | null = null;

function mountVoicePanel(): void {
  const { recognition, synthesis } = browserSpeech();
  const availability = detectVoiceAvailability(recognition, synthesis);
  renderVoicePanel(required("#voice"), availability.available ? { available: true } : { available: false, reason: availability.reason }, {
    onStartListening: () => {
      if (!recognition) return;
      voiceRecognition = recognition;
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? "";
        if (transcript.trim().length > 0) {
          void handleVoiceQuestion(transcript);
        }
      };
      recognition.onerror = () => setVoiceListening(required("#voice"), false);
      recognition.onend = () => setVoiceListening(required("#voice"), false);
      try {
        recognition.start();
        setVoiceListening(required("#voice"), true);
      } catch {
        setVoiceListening(required("#voice"), false);
      }
    },
    onStopListening: () => {
      voiceRecognition?.stop();
      setVoiceListening(required("#voice"), false);
    },
  });
  void synthesis;
}

async function handleVoiceQuestion(transcript: string): Promise<void> {
  const snapshot = state.get();
  const { synthesis } = browserSpeech();
  const result = await runVoiceTurn(transcript, {
    ask: async (question) => {
      const { answer, verdict, uiAction } = await askAgent(question, manager, {
        chokepointId: snapshot.focusChokepointId,
        window: snapshot.timeWindow,
      });
      // §8.6: apply through app state; speak "applied" only on success.
      const applied = uiAction ? applyAgentAction(uiAction) : false;
      // The transcript renders in the shared agent answer surface.
      renderAgentAnswer(required("#agent"), {
        text: answer.text,
        caveats: answer.caveats,
        rejected: answer.rejected,
        evidenceRefs: [],
        verdict: verdict?.verdict ?? "rejected",
      } satisfies AgentAnswerView);
      return { answer: answer.text, verdict: verdict?.verdict ?? null, uiAction, uiActionApplied: applied };
    },
  });
  void result; // spoken + rendered above; nothing persisted (§11.2)
  if (synthesis) {
    synthesis.cancel();
    synthesis.speak({ text: speakableAnswer(result.answer) });
  }
}

// ------------------------------------------------------------------ refresh

/**
 * Data-driven re-render of ALL data views (cursor/selection/window changes).
 * Camera and fences are NOT re-framed here: replay ticks must not move the
 * camera, and the render governor bounds what gets painted. Observations are
 * always the MERGED set across all profiles in ONE showObservations call —
 * sequential per-profile calls would clobber (each call removes every "@"
 * entity first; only the last profile's points would survive).
 */
function refreshView(snapshot: AppStateSnapshot): void {
  if (!globe || !snapshot.timeWindow) return;
  const windowToUse = snapshot.replay.cursor ? replayWindow(snapshot.replay.cursor) : snapshot.timeWindow;
  const snaps = manager.getAllSnapshots(windowToUse);
  globe.showObservations(networkObservations(snaps).observations, snapshot.selectedEntityId);
  // Phase 1.5 P2/P4 node markers and cohort pulses ship ON (the earlier Cesium render crash was traced to
  // `julianDateNumber` vs `dayNumber` in pulsePixelSize — see STATUS.md);
  // ?nonodes / ?nopulse still hide them for QA and escape hatches.
  updateNodeMarkers(snaps);

  renderCompareTable(required("#compare"), compareRows(snaps, (f) => manager.coverageHint(f)), (chokepointId) => {
    state.update({ focusChokepointId: chokepointId });
  }, { sort: compareSort, focusedId: snapshot.focusChokepointId, onSortChange: onSortChange, sparklines: sparklineData });

  // Watchlist evaluates against the SAME shared snapshots (one computation,
  // shared by compare table, watchlist, and focus rail).
  renderWatchlistFor(snaps);

  const focusedSnap = focusSnapshotFor(snapshot, snaps);
  if (focusedSnap) {
    renderFreightHud(required("#hud"), focusedSnap);
    renderEventCards(required("#event-cards"), focusedSnap.events, focusedSnap.comparisons.vesselCount);
    renderEvidenceDrawer(required("#evidence"), focusedSnap);
    renderTimelineControls(focusedSnap);
    attributionText.textContent = focusedSnap.attribution.attributionText;
  } else {
    renderTimelineControls(snaps[0]!);
    attributionText.textContent = uniqueAttributions(snaps);
  }
  if (storyIndex !== null) renderStoryStep();
  renderShareLink();
}

/** Sort-button re-render: compare table only (no scene work, §12.5). */
function onSortChange(sort: CompareSort): void {
  compareSort = sort;
  const snapshot = state.get();
  if (!snapshot.timeWindow || !globe) return;
  const windowToUse = snapshot.replay.cursor ? replayWindow(snapshot.replay.cursor) : snapshot.timeWindow;
  const snaps = manager.getAllSnapshots(windowToUse);
  renderCompareTable(required("#compare"), compareRows(snaps, (f) => manager.coverageHint(f)), (chokepointId) => {
    state.update({ focusChokepointId: chokepointId });
  }, { sort: compareSort, focusedId: snapshot.focusChokepointId, onSortChange: onSortChange, sparklines: sparklineData });
}

/** Watch-remove re-render: panel only. */
function renderWatchlistFor(snaps: readonly ChokepointSnapshot[]): void {
  const evaluations = evaluateWatchlist(watchEntries, (id) => snaps.find((s) => s.profile.id === id) ?? null);
  renderWatchlistPanel(required("#watchlist"), watchEntries, evaluations, (id) => {
    watchEntries = removeWatchEntry(watchEntries, id);
    persistWatchlist();
    renderWatchlistFor(snaps);
  });
}

// ------------------------------------------------------------- story mode

let storyIndex: number | null = null;

/**
 * Apply a story step through app state (§8.6: the tour never touches the
 * scene directly — focus + camera follow from the state update).
 */
function applyStoryStep(step: StoryStep): void {
  const current = state.get();
  if ((current.focusChokepointId ?? null) !== (step.focusId ?? null)) {
    state.update({ focusChokepointId: step.focusId });
  }
}

function startStory(): void {
  storyIndex = 0;
  renderStoryStep();
}

function renderStoryStep(): void {
  if (storyIndex === null) return;
  const snaps = manager.getAllSnapshots(state.get().timeWindow ?? manager.defaultWindow());
  const steps = buildStorySteps(snaps);
  if (steps.length === 0) {
    storyIndex = null;
    return;
  }
  const idx = Math.min(storyIndex, steps.length - 1);
  applyStoryStep(steps[idx]!);
  const barEl = viewRoot.querySelector<HTMLElement>("#story-bar-slot");
  if (barEl) {
    renderStoryBar(barEl, steps[idx]!, idx, steps.length, {
      onPrev: () => {
        if (storyIndex !== null && storyIndex > 0) {
          storyIndex -= 1;
          renderStoryStep();
        }
      },
      onNext: () => {
        if (storyIndex === null) return;
        if (storyIndex < steps.length - 1) {
          storyIndex += 1;
          renderStoryStep();
        } else {
          exitStory();
        }
      },
      onExit: exitStory,
    });
  }
}

function exitStory(): void {
  storyIndex = null;
  const barEl = viewRoot.querySelector<HTMLElement>("#story-bar-slot");
  if (barEl) barEl.innerHTML = "";
}

// ------------------------------------------------------------------- nodes

let lastMarkerSignature: string | null = null;

// P5 sparkline series over the DEFAULT window (computed once at boot — the
// full-timeline shape is context, not a per-tick measurement; replay buckets
// would recompute 50 snapshots per tick).
let sparklineData: Record<string, ReadonlyArray<number | null>> = {};

function computeSparklines(): void {
  const w = manager.defaultWindow();
  const snaps = manager.getAllSnapshots(w);
  sparklineData = headlineSeries(snaps, (id, win) => manager.getSnapshot(id, win), w);
}

/**
 * Node status markers (P2) + cohort pulses (P4), rebuilt from shared
 * snapshots. Rebuilt ONLY when the signature changes — replay ticks do not
 * re-generate sprites (the pulse animates on its own via the viewer clock).
 */
function updateNodeMarkers(snaps: readonly ChokepointSnapshot[]): void {
  const rows = compareRows(snaps, (f) => manager.coverageHint(f));
  const byId = new Map(rows.map((r) => [r.chokepointId, r]));
  const anchors = new Map(nodeAnchors().map((n) => [n.id, n.anchor]));
  const markers: NodeMarker[] = [];
  for (const snap of snaps) {
    const anchor = anchors.get(snap.profile.id);
    if (!anchor) continue;
    const row = byId.get(snap.profile.id);
    const headline = snap.profile.mode === "land"
      ? (row?.headline ? `${row.headline.value} ${row.headline.unit === "minutes" ? "min wait" : row.headline.unit}` : "no facility readings")
      : `${snap.metrics.vesselCount.value ?? "—"} vessels`;
    markers.push({
      id: snap.profile.id,
      name: snap.profile.name,
      anchor,
      headline,
      badge: row?.headline?.badge ?? "UNKNOWN",
      cohort: snap.metrics.dwellCohortSize.value ?? 0,
    });
  }
  const signature = JSON.stringify(markers);
  if (signature === lastMarkerSignature) return;
  lastMarkerSignature = signature;
  const flags = new URLSearchParams(window.location.search);
  const pulseMode = flags.get("pulsemode") ?? "normal"; // normal | nodepth | static | off
  let filtered = markers;
  if (pulseMode === "nodepth") filtered = markers.map((mk) => ({ ...mk, cohort: mk.cohort > 0 ? -1 : 0 }));
  if (pulseMode === "static") filtered = markers.map((mk) => ({ ...mk, cohort: mk.cohort > 0 ? 100 : 0 }));
  if (pulseMode === "off" || flags.has("nopulse")) filtered = markers.map((mk) => ({ ...mk, cohort: 0 }));
  const visible = flags.has("nonodes") ? [] : filtered;
  globe?.showNodeMarkers(visible);
}

function uniqueAttributions(snaps: readonly ChokepointSnapshot[]): string {
  const seen = new Set<string>();
  for (const s of snaps) seen.add(s.attribution.attributionText);
  return [...seen].join("  ·  ");
}

// ---------------------------------------------------------------- timeline

function renderTimelineControls(snap: ChokepointSnapshot): void {
  const el = required("#timeline");
  if (!timeline) return;
  const t = timeline.get();
  el.innerHTML = `
    <button data-testid="play" class="tl-btn">${t.playing ? "Pause" : "Play"}</button>
    <input data-testid="seek" type="range" min="${Date.parse(snap.window.startAt)}" max="${Date.parse(snap.window.endAt)}" step="60000" value="${Date.parse(t.cursor)}" />
    <span data-testid="cursor" class="timeline-cursor">${t.cursor}</span>
    <span class="timeline-window">${snap.window.startAt} → ${snap.window.endAt} (SIM)</span>
  `;
  el.querySelector<HTMLButtonElement>("button")!.addEventListener("click", () => {
    const current = state.get();
    // Starting at the window end would auto-pause on the first tick (advance
    // clamps at the end): restart from the window start, same as the agent
    // start_replay action.
    const atEnd =
      !current.replay.playing &&
      current.replay.cursor !== null &&
      current.timeWindow !== null &&
      current.replay.cursor >= current.timeWindow.endAt;
    state.update({
      replay: {
        playing: !current.replay.playing,
        ...(atEnd && current.timeWindow ? { cursor: current.timeWindow.startAt } : {}),
      },
    });
  });
  el.querySelector<HTMLInputElement>("input")!.addEventListener("input", (e) => {
    const cursor = new Date(Number((e.target as HTMLInputElement).value)).toISOString();
    timeline!.seek(cursor);
    // The cursor is app state: the subscriber re-renders the data views and
    // the scene follows the scrub (§12.5 timeline scrubbing).
    state.update({ replay: { cursor } });
  });
}

// --------------------------------------------------------------- share state

function renderShareLink(): void {
  const el = viewRoot.querySelector<HTMLElement>("#share");
  if (!el) return;
  const url = shareUrl(window.location.origin + window.location.pathname, state.get());
  const link = el.querySelector<HTMLAnchorElement>("a") ?? document.createElement("a");
  link.dataset.testid = "share-link";
  link.href = url;
  link.textContent = "Copy investigation link";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    void navigator.clipboard?.writeText(url);
    link.textContent = "Link copied";
  });
  if (!el.contains(link)) el.appendChild(link);
}

// ------------------------------------------------------------------- wiring

function ensureReplayLoop(): void {
  if (replayTick !== null || !timeline) return;
  replayTick = window.setInterval(() => {
    const before = timeline!.get();
    if (!before.playing) return;
    // Advance FIRST, then publish the NEW cursor. Capturing before the
    // advance publishes a one-tick-stale cursor that the subscriber then
    // seeks back to — the cursor would never visibly move (§12.5).
    const after = timeline!.advance(500); // fixed 500ms tick: deterministic given dt
    state.update({ replay: { cursor: after.cursor, playing: after.playing } });
  }, 500);
}

state.subscribe((snapshot) => {
  if (!snapshot.timeWindow) {
    // No window yet: nothing to render data views against. The boot sequence
    // sets a default window BEFORE the first subscriber run; this guard keeps
    // a malformed share restore from crashing the loop honestly.
    return;
  }
  if (!timeline) {
    timeline = new TimelineController(snapshot.timeWindow, snapshot.replay.speedMultiplier);
  } else if (
    timeline.get().window.startAt !== snapshot.timeWindow.startAt ||
    timeline.get().window.endAt !== snapshot.timeWindow.endAt
  ) {
    // Window change (e.g. set_time_window action): re-bind deterministically.
    timeline.setWindow(snapshot.timeWindow);
  }
  // App state owns playing (§8.6): play/pause — from the button, an agent
  // action, or a restored share link — flows through the snapshot.
  if (snapshot.replay.playing !== timeline.get().playing) {
    if (snapshot.replay.playing) timeline.play();
    else timeline.pause();
  }
  // P3: corridor arcs flow during replay playback; static when paused.
  globe?.setRouteFlow(snapshot.replay.playing);
  timeline.seek(snapshot.replay.cursor ?? snapshot.timeWindow.endAt);
  // Focus transitions MAY move the camera (§4.1 framing serves the data
  // view); data-only refreshes never do (§12.5: replay ticks never move the
  // camera). Focus changes never re-call showFences.
  if (snapshot.focusChokepointId !== shownFocusId) {
    shownFocusId = snapshot.focusChokepointId;
    if (globe) {
      if (snapshot.focusChokepointId) {
        const profile = manager.listChokepoints().find((c) => c.id === snapshot.focusChokepointId);
        const primary = profile ? primaryFence(profile) : null;
        // Frame the fence that actually contains the observations (the
        // waiting-cohort fence when present), not the wide approach corridor
        // — the same primary-fence rule the node anchors use (§4.1).
        if (primary && primary.geometry.kind === "polygon") globe.frameRing(primary.geometry.ring);
      } else {
        globe.frameAll(nodeAnchors().map((n) => n.anchor));
      }
    }
    // Focus rail content switches with focus; refreshView fills the data.
    renderFocusPanel(snapshot);
  }
  refreshView(snapshot);
  ensureReplayLoop();
});

// --- Boot (NETWORK-VIEW-PLAN.md Phase 1 step 6 truth table):
// - no share link (or no c= param): NETWORK view — focus null, default window.
// - c= share link: focused view restored; window from t0/t1, else default.
// The network view is the default landing; there is no launcher screen.
const boot = state.get();
mountNetworkShell();
renderNetworkScene();
if (!boot.timeWindow) {
  const w = manager.defaultWindow();
  state.update({ timeWindow: w, replay: { cursor: w.endAt, playing: false } });
}
computeSparklines();
const bootSnaps = manager.getAllSnapshots(state.get().timeWindow ?? manager.defaultWindow());
if (boot.focusChokepointId) {
  shownFocusId = boot.focusChokepointId;
  renderFocusPanel(state.get());
  const g = getGlobe();
  const bootFocused = focusSnapshotFor(state.get(), bootSnaps);
  if (bootFocused && g) {
    const primary = primaryFence(bootFocused.profile);
    if (primary.geometry.kind === "polygon") g.frameRing(primary.geometry.ring);
  }
} else {
  // Landing frame (P1): set high, then one fixed-duration settle fly-in over
  // the whole network. §4.1 framing serves the data view; duration is fixed
  // and deterministic (§12.5 has no wall clock — this is camera-only motion).
  getGlobe()?.bootFlyIn(nodeAnchors().map((n) => n.anchor));
}
refreshView(state.get());
