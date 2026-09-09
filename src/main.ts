/**
 * Chokepoint — application entry point.
 *
 * Phase 0/1 status (see STATUS.md): this is a buildable placeholder surface.
 * The Cesium globe, freight HUD, and mission launcher are Phase 3 deliverables
 * (CHOKEPOINT-PLAN.md §17) and are deliberately not implemented here.
 *
 * Data in this phase is fixture-mode only (SIMULATED truth state, §3.1, §6.2).
 * No provider credentials are read anywhere in Phase 0/1 code paths.
 */

import { appVersion } from "./app";

const root = document.querySelector<HTMLDivElement>("#app");

if (root) {
  root.innerHTML = `
    <main>
      <h1>Chokepoint</h1>
      <p>Provenance-aware transportation intelligence.</p>
      <p data-testid="build-state">
        Phase 0/1 scaffold — deterministic domain code and fixtures only.
        No live provider integration (fixture mode per §6.2 / §16.1).
      </p>
      <p data-testid="app-version">app version: ${appVersion}</p>
    </main>
  `;
}
