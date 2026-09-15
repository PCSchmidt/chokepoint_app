# Unified network view: globe + route arcs + compare dashboard

## Context

The app currently shows one chokepoint profile at a time (Long Beach, Singapore,
Suez, LAX cargo air, El Paso border), selected from a mission launcher that
swaps the whole view. The user's complaint: it reads as five disconnected
postage stamps rather than a system, and doesn't "tell much of a story."

Exploration confirmed the fix is architecturally cheap where it matters most:

- `manager.getSnapshot(chokepointId, window)` (`src/data/manager.ts:129`) is a
  pure per-call function with no shared mutable state — safe to call once per
  registry profile and merge results (the watchlist code in `main.ts`
  `renderLauncher()` already does exactly this, synchronously).
- `src/analytics/*` metric/event functions are pure and scope-namespaced
  (`metricId`/`eventId` embed scope) — multiple profiles' snapshots can
  coexist in memory with zero collision risk.
- `metricCards()` (`freightHud.ts:50`) and `eventCardViewModel()`
  (`eventCards.ts:33`) already separate pure view-model building from DOM
  writing — directly reusable per-node without rewriting the metric logic.

What needs to change is the *orchestration* layer: `AppStateSnapshot`
(`appState.ts:30`) and `shownChokepointId` (`main.ts`) both hard-assume a
single active profile, and `showFences`/`showObservations` in `globe.ts` are
only ever called for one profile's data at a time.

This plan has two parts:

- **Phase 1 — the substrate**: unified globe, route arcs, compare dashboard.
  Pure orchestration; no new visual language. A visitor sees everything at
  once instead of swapping views.
- **Phase 1.5 — presence and narrative**: the layer that makes the network
  view *impressive* rather than merely correct. The structural fix alone does
  not address "doesn't tell much of a story"; that lives in motion, node
  identity, and a guided tour (see the Phase 1.5 section).

Deferred explicitly (call out in STATUS.md, don't build now): broader
intermodal facility coverage, multi-profile agent "compare" intents in
`agent/tools.ts` (its single-scope `runTool` design is sound as-is and out of
scope here).

## Code-verified constraints (fold into implementation)

These were verified against the current source; each one is a trap the
original draft missed.

- **`showObservations` clobbers across profiles.** It removes every entity
  whose id contains `"@"` before drawing. Calling it once per profile leaves
  only the last profile's points. Observations must be MERGED across snapshots
  and drawn in ONE call per refresh (every replay tick redraws the merged
  set). Make the merge a pure, node-testable function (e.g.
  `networkObservations(snapshots)` in `src/ui/compareTable.ts` or a sibling) —
  not inline logic in `main.ts`.
- **`getAllSnapshots` is synchronous.** `getSnapshot` returns
  `ChokepointSnapshot`, not a Promise. A plain loop over the registry returns
  `ChokepointSnapshot[]`; `Promise.all` is wrong here and would force the sync
  replay-tick render path (`refreshInvestigation`) to become async.
- **Entity id rules: profile-prefix yes, `@` never.** Fence ids in the
  registry are already globally unique across profiles today (the original
  collision premise was wrong — `showFences` stores them as
  `fence-${id}`/`fence-line-${id}` and no two profiles share a fence id).
  Prefixing with profile id is still worth doing as future-proofing and to
  enable per-profile removal. Hard rule: no new entity id may contain `@` —
  the observation-removal heuristic is literally "id contains `@`" and would
  wipe prefixed fences/arcs on every refresh.
- **`showFences` is additive with no removal.** Add an idempotent clear
  (remove entities by `fence-`/`route-` prefix) and call it before redraw.
  This also fixes an existing latent bug: an agent `focus_chokepoint` action
  while an investigation is open re-calls `showFences` on a live globe and
  accumulates the previous profile's fences.
- **One state field, renamed — not two.** Replace `chokepointId` with
  `focusChokepointId: string | null` everywhere (share state, agent context
  in `handleAgentQuestion`/`handleVoiceQuestion`/`applyAgentAction`,
  `addWatch`). Two fields encoding one concept invites desync. Null = network
  view. The clearing-on-change semantics transfer as-is. Agent behavior stays
  honest: `runTool` already refuses with "no chokepoint in context" on null
  scope, and `intent.ts` resolves a named chokepoint from question text, so
  the agent remains usable on the network view when the user names one.
- **Share state needs no new param.** The existing `c=` hash param already
  encodes exactly this: absent `c` → network view (focus null), present `c` →
  focus. A `?focus=` query param would contradict the §11.1 hash-only scheme.
  Only the field rename carries into `shareState.ts`.
- **The network view needs a window.** The launcher today runs with
  `timeWindow: null`; compare rows need a window. Boot truth table:
  - No share link: `focusChokepointId: null`, `timeWindow = defaultWindow()`.
  - Share link with `c=`: focus set, window from `t0/t1` (or default).
  The subscriber's view branch re-keys on `focusChokepointId === null`.
- **Compare rows are mode-sensitive.** El Paso (land) has empty entity
  metrics; its real headline is `facilityCards()` (CBP waits), which lives
  outside `metricCards`. A naive entity-metric headline renders El Paso as
  "—" everywhere — which reads as "no activity" (§3.3 violation by accident).
  `compareRows` must pick the headline per mode and surface
  `multimodalNotice` in the row.
- **Per-profile observation budget now, not later.** Fixture mode is tiny
  (5–16 observations per profile), but `showObservations` draws unbounded
  points and live data will not stay small. Apply the existing
  `renderGovernor.selectBoundedCohort` / `OVERLAY_BUDGETS` per profile in
  network mode from day one so the live rollout inherits the bound for free.

## Phase 1 implementation steps

1. **`src/config/routes.ts` (new).** Declare route legs as pairs of chokepoint
   ids — only legs that make narrative sense; air (LAX) and land (El Paso)
   profiles are nodes with zero legs, never forced into a maritime corridor
   chain. The arc list is data-declared and empty-permitted. Plus a pure
   `centroidOfRing(ring): [number, number]` helper (simple vertex-mean — a
   visual anchor, not a geometric claim) used to resolve each leg's endpoints
   from the existing reviewed fence rings in `src/config/chokepoints.ts`.
   Pin the "primary fence" rule to the exact selection already used in
   `openInvestigation` (`waiting-cohort` ?? `approach-flow` ?? first) so arcs
   and focus camera agree. Export `resolveRouteArcs(): RouteArc[]` giving
   `{ id, fromId, toId, from: [lat,lon], to: [lat,lon], label }`.

2. **`src/scene/globe.ts`: add `showRoutes(arcs)` and `clearOverlays()`.**
   `showRoutes` draws one dashed `polyline` entity per arc
   (`arcType: Cesium.ArcType.GEODESIC`, distinct material from fence
   outlines), each with a `description` tooltip stating it's illustrative.
   `clearOverlays()` removes `fence-*` / `route-*` entities by prefix —
   idempotent, called before any redraw. Keep `showFences` / `showObservations`
   signatures unchanged; prefixing happens at the call site. No entity id
   may contain `@` (see constraints).

3. **`src/data/manager.ts`: add `getAllSnapshots(window): ChokepointSnapshot[]`.**
   Synchronous loop over `CHOKEPOINT_REGISTRY` calling the existing
   `getSnapshot(id, window)` per profile. Mirrors the watchlist pattern, just
   generalized. One computation is shared by the compare table, the watchlist
   panel, and the focus rail — no per-consumer re-computation.

4. **`src/ui/compareTable.ts` (new).** Pure view-model function
   `compareRows(snapshots: ChokepointSnapshot[])`: calls the existing
   `metricCards(snapshot)` per profile, picks the headline metric(s) PER MODE
   (land → `facilityCards`), plus coverage/badge state per row, and surfaces
   `multimodalNotice`. Also exports the pure `networkObservations(snapshots)`
   merge (bounded per profile via `renderGovernor`). A thin
   `renderCompareTable(container, rows, onSelect)` DOM writer with rows
   sortable by "most anomalous" (reuse event/detector output already in each
   snapshot) or region. Row click invokes `onSelect(chokepointId)` to set
   focus. Per-row sparkline from windowed metrics is a Phase 1.5 item (P5).

5. **`src/app/appState.ts`: rename, don't duplicate.** `chokepointId` →
   `focusChokepointId: string | null` (null = network view). Update the
   clearing-on-change logic in place. Update `shareState.ts` field name only
   (no new param — see constraints). Every reader of the old field updates:
   agent context, `applyAgentAction`, `addWatch`, boot share-restore.

6. **`src/main.ts`: rewrite the view orchestration.**
   - On startup: `getAllSnapshots()`, render the globe with every profile's
     fences (prefixed ids) + ONE merged `showObservations` call +
     `showRoutes(resolveRouteArcs())`, and render the compare table in the
     left rail.
   - **Boot state truth table** (see constraints): no share link → network
     view with default window; `c=` share link → focused view.
   - **Camera**: add a `frameAll` (bounding view over the primary-fence
     centroids) for the network landing; focus change flies to the profile
     reusing `frameRing`. The §12.5 invariant is unchanged: replay ticks
     never move the camera; focus changes may.
   - Focus change re-renders the existing `renderFreightHud` /
     `renderEventCards` / `renderEvidenceDrawer` calls, unchanged, in the
     right rail. Focus change MUST NOT re-call `showFences`.
   - **Watchlist relocation** (explicit step, or it gets dropped): the watch
     panel moves to the compare rail and evaluates against the same
     `getAllSnapshots` output; the focus-scoped watch-save form stays in the
     focus rail.
   - The launcher screen goes away; `launcherCards` logic is absorbed into
     `compareRows`.
   - Existing debug hooks (`__chokepointDebug`, `pickPointEntities`) keep
     working since they read `globe.viewer.entities` directly.

7. **`src/styles.css`: add network layout.** New `.network` grid (compare
   table rail | globe | focus rail), reusing existing `--bg-panel`/`--border`/
   badge classes — no new visual language yet; that is Phase 1.5.

## Phase 1.5 — presence and narrative (the part that makes it impressive)

Phase 1 makes the app structurally honest; it does not make it compelling.
The visitor lands on a globe with dots and a table. The complaint "doesn't
tell much of a story / isn't attractive" is not a data problem — the fixtures
and metrics already contain the story. It is a *presentation* problem. These
items are ordered by impact-per-effort; none touch the agent, evaluator, or
data contracts, and every visual remains an affordance, never a claim
(SIM badges and illustrative labels stay).

- **P1 — The five-second landing.** A deterministic boot sequence: the globe
  opens framed on the whole network (`frameAll`), then one slow fixed-duration
  `flyTo` settles to working altitude. Node markers and arcs are visible from
  the first frame. Cost: ~20 lines of camera code. This is the single
  cheapest "wow" item and it requires no new data.
- **P2 — Node markers as the story layer.** Replace anonymous dots with
  labeled status markers per chokepoint: name + headline metric + badge color
  (health/anomaly direction), rendered as a Cesium billboard from a
  canvas-drawn sprite (no new deps — the project's pattern). Colors encode
  the truth-state vocabulary already in the codebase (fresh/degraded/unknown;
  anomaly direction from the existing comparison output). This turns the
  globe into a glanceable "world freight health map," which IS the story.
- **P3 — Corridor flow animation.** Animate the dashed arcs' dash offset
  during replay playback only, driven by the replay clock (replay ticks
  already drive renders under `requestRenderMode`; no wall clock, §12.5).
  Static when paused. Reads as "flow through the system" while remaining an
  illustrative affordance with its honest tooltip.
- **P4 — Waiting-cohort pulse.** At each node, a subtle pulsing/glowing ring
  sized by the dwell-cohort metric already computed in the snapshot. "Where
  the ships are stacked" is the most legible sentence this dataset can speak,
  and it is fully supported by existing DERIVED metrics. Driven by replay
  ticks like P3.
- **P5 — Sparklines in compare rows.** Pure canvas mini-charts of vessel
  count (or mode headline) over the window, rendered from snapshot metrics.
  Makes the compare table feel analytical instead of tabular. No deps.
- **P6 — Guided story mode (the actual "story").** A scripted, deterministic
  4–6 step tour: e.g. congestion builds in the Long Beach anchorage → dwell
  rises → an event card fires → cut to Singapore for contrast → closing
  caveat about coverage. Each step sets `focusChokepointId`, window, and
  camera via the existing state; narration is generated from the same
  evidence bundles the agent uses (LIMITATION caveats included — the tour
  models the honest voice). This was deferred in the original plan; a minimal
  version is the highest-impact answer to "tells no story" and belongs in
  scope.
- **P7 — Curate the fixtures for a narrative arc.** The checked-in SIMULATED
  fixtures are hand-authored demo data (explicitly badged, §3.1 — this is
  legitimate demo design, not data dishonesty). Shape one or two profiles'
  fixture timelines so the default replay window contains a visible arc
  (buildup → peak → easing) that P4/P6 can highlight. Without this, the
  replay shows flat noise and no tour can land.
- **P8 — Polish pass.** Semi-transparent panels floating over the globe
  (glasses-and-vignette treatment), one accent color per transport mode,
  CSS transitions on focus-panel slide-in, hover tooltips on nodes, and a
  compact legend (fence colors, arc = illustrative corridor, badge
  vocabulary). Reuses existing CSS variables; no new visual system.

**Sequencing:** Phase 1 first (substrate), then P1–P3 (presence), then
P6–P7 (narrative), with P4, P5, P8 filling in. P7 should land before or with
P6 — a tour over flat fixtures defeats itself.

## Tests / verification

- New node tests for `src/config/routes.ts` (`centroidOfRing` correctness on
  known rings, `resolveRouteArcs()` produces one arc per declared leg with
  valid endpoints) and `src/ui/compareTable.ts` (`compareRows` produces one
  row per registry profile, headline is mode-aware — El Paso's headline comes
  from facility metrics, badges match the underlying `metricCards`/`facilityCards`
  output, `networkObservations` merge preserves ALL profiles' observations —
  the merge-clobber regression is exactly what this test exists to catch).
- Update `src/app/appState.ts` tests for the renamed focus field. Audit
  `phase3-ui.test.ts` and watchlist tests for launcher assumptions.
- `scripts/qa-browser.ts` needs a REWRITE of its navigation section, not just
  additions: it asserts launcher-first landing (`[data-testid^=launcher-]`),
  the back-to-launcher loop, and per-profile vessel-count cards — all of
  those flows change. New assertions: all five profiles' fence outlines and
  merged observation points render simultaneously on the network view
  (entity-count / pixel-sampling, following the existing `pickPointEntities`
  pattern), route-arc polylines are present, and row-click focus opens the
  correct HUD.
- Full regression: `npm test` (326+ existing tests must stay green),
  `npm run eval` and `npm run eval:agent` (untouched — agent/detector logic
  isn't modified), `npm run perf:replay` (fixture-mode entity growth is
  modest — ~100 points + fences + arcs vs a 33ms render budget — so this is a
  check, not a risk; the real bound is the per-profile render-governor budget
  from the constraints section, which exists for live mode).
- Manual: `npm run dev`, confirm the network view is the landing page, arcs
  render with honest tooltip text, row click opens the correct focus panel,
  replay ticks redraw the merged scene without moving the camera, watchlist
  panel evaluates from the shared snapshots.
- Phase 1.5 acceptance (the honest test): hand the github.io URL to someone
  for five seconds, then ask what they saw. If the answer is "a map of global
  shipping chokepoints with live-ish status," P1–P2 did their job. If they
  can retell one thing that happened during replay, P6–P7 did.
