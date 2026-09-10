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
window.CESIUM_BASE_URL = "/cesium/";

import "./styles.css";
import { startup } from "./app/startup";
import { shareUrl } from "./app/shareState";
import { createFreightGlobe, type FreightGlobe } from "./scene/globe";
import { renderMissionLauncher, launcherCards } from "./ui/missionLauncher";
import { renderFreightHud } from "./ui/freightHud";
import { renderEventCards } from "./overlays/eventCards";
import { renderEvidenceDrawer } from "./ui/evidenceDrawer";
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
  const primary = profile.geofences.find((ge) => ge.purpose === "approach-flow") ?? profile.geofences[0]!;
  if (primary.geometry.kind === "polygon") {
    g.frameRing(primary.geometry.ring);
  }
  const windowToUse = snapshot.replay.cursor ? replayWindow(snapshot.replay.cursor) : snapshot.timeWindow!;
  const snap = manager.getSnapshot(chokepointId, windowToUse);
  g.showObservations(snap.observations, snapshot.selectedEntityId);
  renderFreightHud(required("#hud"), snap);
  renderEventCards(required("#event-cards"), snap.events, snap.comparisons.vesselCount);
  renderEvidenceDrawer(required("#evidence"), snap);
  renderTimelineControls(snap);
  renderShareLink();
  attributionText.textContent = snap.attribution.attributionText;
  shownChokepointId = chokepointId;
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
    t.playing ? timeline!.pause() : timeline!.play();
    renderTimelineControls(snap);
  });
  el.querySelector<HTMLInputElement>("input")!.addEventListener("input", (e) => {
    timeline!.seek(new Date(Number((e.target as HTMLInputElement).value)).toISOString());
    renderTimelineControls(snap);
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
    const t = timeline!.get();
    if (t.playing) {
      timeline!.advance(500); // fixed 500ms tick: deterministic given dt (§12.5)
      state.update({ replay: { cursor: t.cursor } });
    }
  }, 500);
}

state.subscribe((snapshot) => {
  if (!snapshot.chokepointId || !snapshot.timeWindow) {
    if (view !== "launcher") renderLauncher();
    return;
  }
  if (!timeline) {
    timeline = new TimelineController(snapshot.timeWindow, snapshot.replay.speedMultiplier);
  }
  timeline.seek(snapshot.replay.cursor ?? snapshot.timeWindow.endAt);
  if (snapshot.chokepointId !== shownChokepointId) {
    openInvestigation(snapshot);
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
