/**
 * Chokepoint application entry (CHOKEPOINT-PLAN.md §9.2, §9.3).
 *
 * Working application, not a marketing hero: mission launcher -> investigation
 * (globe + freight HUD + event cards + timeline + evidence drawer). Fixture
 * mode by default; the SIM badge is visible whenever simulated data is shown
 * (§3.1). Attribution is always rendered (§9.3, §15). Share state is the URL
 * hash only (§11.1/§11.2 — no secrets).
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
import { createFreightGlobe, type FreightGlobe } from "./scene/globe";
import { renderMissionLauncher, launcherCards } from "./ui/missionLauncher";
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
import type { ChokepointSnapshot } from "./data/manager";
import type { AppStateSnapshot } from "./app/appState";
import type { PolygonRing } from "./config/chokepoints";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("#app container missing");

type View = "launcher" | "investigation";
let view: View = "launcher";
let globe: FreightGlobe | null = null;
let shownChokepointId: string | null = null;
let timeline: TimelineController | null = null;
let replayTick: number | null = null;
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
  </footer>
`;

const viewRoot = document.querySelector<HTMLDivElement>("#view-root")!;
const attributionText = document.querySelector<HTMLSpanElement>("#attribution-text")!;

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

/**
 * Agent turn (§8): question -> deterministic tools -> evidence bundle ->
 * evaluator -> caveated answer. The wall clock is not read: the window is
 * the current investigation state.
 */
async function handleAgentQuestion(question: string): Promise<void> {
  const snapshot = state.get();
  const answerEl = required("#agent");
  const { answer, uiAction } = await askAgent(question, manager, {
    chokepointId: snapshot.chokepointId,
    window: snapshot.timeWindow,
  });
  let appliedNote: string | null = null;
  if (uiAction) {
    const outcome = applyAgentAction(uiAction);
    appliedNote = outcome ? "Applied to the current view." : "Not applied — no investigation is open.";
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
 * ownership is separate from analytics). Returns true only when the state
 * update was actually issued — the response may claim success only then.
 */
function applyAgentAction(action: UiAction): boolean {
  const snapshot = state.get();
  switch (action.action) {
    case "focus_chokepoint": {
      const window = manager.defaultWindow();
      state.update({
        chokepointId: action.chokepointId,
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
  const chokepointId = state.get().chokepointId;
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

// ------------------------------------------------------------- launcher view

function renderLauncher(): void {
  view = "launcher";
  shownChokepointId = null;
  if (globe) {
    globe.destroy();
    globe = null;
  }
  viewRoot.innerHTML = `<div id="launcher" class="launcher"></div>`;
  const launcherEl = viewRoot.querySelector<HTMLDivElement>("#launcher")!;
  const cards = launcherCards(manager.listChokepoints(), (fenceId) => manager.coverageHint(fenceId));
  // Watchlist (Workflow E): saved watches evaluated against the fixture replay.
  const watchEl = document.createElement("div");
  watchEl.id = "watchlist";
  watchEl.className = "watchlist";
  launcherEl.appendChild(watchEl);
  const evaluations = evaluateWatchlist(watchEntries, (id) =>
    manager.listChokepoints().some((c) => c.id === id) ? manager.getSnapshot(id, manager.defaultWindow()) : null,
  );
  renderWatchlistPanel(watchEl, watchEntries, evaluations, (id) => {
    watchEntries = removeWatchEntry(watchEntries, id);
    persistWatchlist();
    renderLauncher();
  });
  renderMissionLauncher(launcherEl, cards, (chokepointId) => {
    state.update({
      chokepointId,
      timeWindow: manager.defaultWindow(),
      replay: { cursor: manager.defaultWindow().endAt, playing: false },
    });
  });
}

// ------------------------------------------------------ investigation view

function mountInvestigationShell(): void {
  viewRoot.innerHTML = `
    <div class="investigation">
      <aside class="left-rail">
        <button id="back-to-launcher" data-testid="back-to-launcher">← All chokepoints</button>
        <div id="watch-save" class="watch-save-slot"></div>
        <div id="agent" class="agent-slot"></div>
        <div id="voice" class="voice-slot"></div>
        <div id="hud" class="hud"></div>
        <div id="event-cards" class="event-cards"></div>
      </aside>
      <main class="globe-pane">
        <div id="globe"></div>
        <div id="timeline" class="timeline"></div>
        <div id="share" class="share"></div>
      </main>
      <aside class="right-rail">
        <div id="evidence" class="evidence"></div>
      </aside>
    </div>
  `;
  globe = createFreightGlobe(required("#globe"));
  required("#back-to-launcher").addEventListener("click", () => {
    state.update({ chokepointId: null, timeWindow: null });
  });
  // The save form and agent panel depend only on the profile — render once at
  // mount so the details elements keep their open state across replay ticks.
  renderWatchlistSaveForm(required("#watch-save"), manager.listChokepoints().find((c) => c.id === state.get().chokepointId)?.name ?? "chokepoint", addWatch);
  renderAgentPanel(required("#agent"), (question) => {
    void handleAgentQuestion(question);
  });
  mountVoicePanel();
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
        chokepointId: snapshot.chokepointId,
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

function openInvestigation(snapshot: AppStateSnapshot): void {
  const chokepointId = snapshot.chokepointId!;
  if (view !== "investigation") {
    view = "investigation";
    mountInvestigationShell();
  }
  const g: FreightGlobe = globe ?? createFreightGlobe(required("#globe"));
  globe = g;
  g.showFences(reviewedRings(chokepointId).map((r) => ({ id: r.id, ring: r.ring, label: r.id })));
  const profile = manager.listChokepoints().find((c) => c.id === chokepointId)!;
  // Frame the fence that actually contains the observations (the waiting-cohort
  // fence when present), not the wide approach corridor — §4.1 camera framing
  // serves the data view, not the widest region.
  const primary =
    profile.geofences.find((ge) => ge.purpose === "waiting-cohort") ??
    profile.geofences.find((ge) => ge.purpose === "approach-flow") ??
    profile.geofences[0]!;
  if (primary.geometry.kind === "polygon") {
    g.frameRing(primary.geometry.ring);
  }
  shownChokepointId = chokepointId;
  refreshInvestigation(snapshot);
}

/**
 * Data-driven re-render of the investigation view (cursor/selection/window
 * changes). Camera and fences are NOT re-framed here: replay ticks must not
 * move the camera, and the render governor bounds what gets painted.
 */
function refreshInvestigation(snapshot: AppStateSnapshot): void {
  if (view !== "investigation" || !globe) return;
  const chokepointId = snapshot.chokepointId!;
  const windowToUse = snapshot.replay.cursor ? replayWindow(snapshot.replay.cursor) : snapshot.timeWindow!;
  const snap = manager.getSnapshot(chokepointId, windowToUse);
  globe.showObservations(snap.observations, snapshot.selectedEntityId);
  renderFreightHud(required("#hud"), snap);
  renderEventCards(required("#event-cards"), snap.events, snap.comparisons.vesselCount);
  renderEvidenceDrawer(required("#evidence"), snap);
  renderTimelineControls(snap);
  renderShareLink();
  attributionText.textContent = snap.attribution.attributionText;
}

// ------------------------------------------------------------------ timeline

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
  if (!snapshot.chokepointId || !snapshot.timeWindow) {
    if (view !== "launcher") renderLauncher();
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
  timeline.seek(snapshot.replay.cursor ?? snapshot.timeWindow.endAt);
  if (snapshot.chokepointId !== shownChokepointId) {
    openInvestigation(snapshot);
  } else if (view === "investigation") {
    // Cursor, selection, and overlay changes drive the data views (§12.5:
    // scrubbing and replay update the scene; the camera stays put).
    refreshInvestigation(snapshot);
  }
  ensureReplayLoop();
});

// --- Initial view: share link restores an investigation; else the launcher. ---
const boot = state.get();
if (boot.chokepointId && boot.timeWindow) {
  view = "investigation";
  openInvestigation(boot);
} else {
  renderLauncher();
}
