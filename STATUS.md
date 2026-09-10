# STATUS.md — What Is Actually Built

This file records measured progress and known limitations, not optimistic
completion claims. Claims here must match the repository.

**Phases 0–3 complete. Phase 4 (verified agent) COMPLETE in deterministic fixture mode: typed intents, deterministic tools, evidence bundles, claim evaluator, text query surface, groundedness report 19/19. No LLM/voice — those are the deferred Phase 4 remainder.**

## Phase 3 CLOSE-OUT (2026-09-10): watchlist, measured budgets, PWA

- **Watchlist (Workflow E)**: `src/app/watchlist.ts` + `src/ui/watchlist.ts`.
  A saved watch records chokepoint, geofence ids, metric, direction, relative
  threshold, and freshness policy (Workflow E step 2), persists to
  localStorage (§11.1; corrupt entries skipped, never crash), and evaluates
  DETERMINISTICALLY against the replay dataset (step 4) — no scheduled jobs,
  no external notifications (§11.3). Unknown comparisons and null metrics
  NEVER fire; `require-fresh` refuses stale/degraded baselines. Language is
  threshold-crossing only (§14.4). Save form lives in the investigation left
  rail; the watch panel (FIRED/CLEAR/UNKNOWN/UNAVAILABLE badges) on the
  launcher. 11 tests.
- **Replay performance profile (`npm run perf:replay`, §12.5 budgets v1)**:
  measures REAL Cesium render cost (preRender/postRender deltas — the app runs
  requestRenderMode, so rAF rate is not a render measure), in-page scrub
  latency, idle renders after settle, and heap growth over 5 globe
  mount/unmount cycles. Artifacts: `research/perf/`. PASSING baselines:
  replay render mean ~1.7ms / p95 ~2.9ms / max ~4.9ms (budgets 33/250ms);
  scrub mean ~130ms / max ~176ms (budget 250ms); idle renders 0 (budget 1);
  heap growth 0.0% (budget 50%). The profiler CAUGHT A REAL BUG: scrub and
  replay cursor changes never updated the globe (the state subscriber only
  re-rendered on chokepoint change). Fixed — cursor changes now refresh the
  data views and scene via `refreshInvestigation`; the camera never moves on
  ticks.
- **PWA (§16.4, Decision 5)**: `public/manifest.webmanifest` (standalone,
  theme #0b1626), icons 192/512 (generated inline, no new deps, maskable
  variant included), `public/sw.js` offline shell — precached app shell,
  bounded (200-entry) runtime cache for same-origin GETs, cross-origin NEVER
  cached (map imagery stays network-bound; attribution stays honest),
  network-first navigation. SW registers in production builds only, and is
  failure-tolerant. Verified on the production build: SW active, and the
  launcher renders with the network offline (CDP offline emulation). 9 tests.
- Phase 3 exit criteria now all met: core investigation without voice;
  deterministic replay; browser performance measured within documented
  budgets; attribution visible in all views.

## Phase 4: verified agent (deterministic core, 2026-09-10)

- **Typed query intents** (`src/agent/intent.ts`, §4.4): a deterministic
  closed-vocabulary parser maps a question onto the §4.4 tool allowlist
  (count_vessels, summarize_chokepoint, compare_with_baseline,
  list_recent_changes, explain_metric wired; replay/focus/cohort controls
  reserved for UI actions). Unmatched questions ABSTAIN with a reason — the
  parser never infers scope; relative windows resolve against data
  availability, never the wall clock.
- **Deterministic data tools** (`src/agent/tools.ts`, §8.1/§8.2): the ONLY
  agent data path is manager snapshots. Claims are typed
  (OBSERVATION/CALCULATION/COMPARISON/QUALITY/LIMITATION) and every claim
  cites a metric/event/comparison id. A zero count over zero observations is
  emitted as "coverage unknown, not zero" (§3.3/§7.1) — never "no activity".
- **Evidence bundle builder** (`src/agent/evidenceBundle.ts`, §5.6): content-
  addressed bundleId (FNV-1a of question+scope — no clock), normalized
  intent, windowed observation references, tool claims, source health, and
  schema/tool versions. Abstentions are first-class.
- **Claim evaluator** (`src/agent/evaluator.ts`, §8.3–8.5,
  `claim-evaluator-v1`): deterministic gates — banned causal/threat/
  prediction/intent/identity language, provenance-required, "all vessels at
  the port" scope overreach rejected, EVERY number must match a referenced
  metric value, freshness/coverage caveats required when material. Output is
  the §8.5 verdict shape (accepted claim ids, rejected claims with reasons,
  required caveats, evaluator version).
- **Generator** (`src/agent/generator.ts`, §8.2): drafts answers ONLY from
  the accepted portion of an evaluated bundle; the evaluator cannot be
  bypassed (the generator accepts a verdict object, not raw claims).
  Deterministic template assembly in fixture mode — an LLM can later replace
  the wording without changing the contract.
- **Text query surface** (`src/ui/agentPanel.ts`): question box in the
  investigation view; EVALUATED/NOT ANSWERED badge, caveats, and rejected-
  claim transparency rendered (never silently dropped).
- **Groundedness evaluation** (`npm run eval:agent`, §12.4/§12.6): 19 labeled
  scenarios — numeric accuracy, provenance coverage, scope-mismatch
  rejection, banned-language rejection (THREAT/CAUSE/PREDICTION/INTENT),
  derived-vs-observed labeling, abstention quality. **19/19 PASS**
  (`evaluation-reports/agent-2026-09-10.md`). 15 vitest scenarios assert the
  same rules in CI.
- **UI-action intents wired (§4.4/§8.6)**: focus_chokepoint,
  set_time_window, start_replay, stop_replay parse and return VALIDATED
  UiAction requests (no claims; nothing for the evaluator to gate). main.ts
  applies them through app state and only then reports "Applied" — the tool
  note never claims the visual state changed by itself. set_time_window
  resolves relative windows against available data (clamped, never widened);
  start_replay restarts from the window start when the cursor sits at the
  end (advance clamps and would auto-pause instantly).
- **Replay cursor bug fixed (§12.5)**: the tick loop captured the timeline
  state BEFORE advancing and published a one-tick-stale cursor, which the
  subscriber then seeked back — the visible cursor never moved during
  replay. The tick now publishes the post-advance cursor and playing flag;
  the play/pause button and the subscriber make app state the single source
  of truth (playing syncs into the controller; auto-pause at window end is
  state, not just controller-internal). Play-from-window-end now restarts
  from the window start instead of silently doing nothing.
- Phase 4 exit criteria met for the text surface: unsupported claims are
  rejected or caveated; numeric answers match deterministic metrics; provider
  failure renders honest UNKNOWN (no fabricated answers). Voice remains
  deferred by Decision 2.

## Phase 5 (in progress): health/readiness, metrics, structured logs

- **Health/readiness (§16.1, §10.3)**: `src/telemetry/health.ts` — liveness
  (`/api/health`: process up, injected uptime) and readiness (`/api/ready`:
  profiles registered, default window resolvable, per-source honest health
  states). A missing live key is UNAVAILABLE — reported, never hidden, and
  never a readiness failure (fixture mode is the keyless path, §6.2).
  Responses use the stable §10.3 envelope.
- **Application server** (`src/server/server.ts`, `npm run serve`, §10.1
  one-process local-first): hosts `/api/health`, `/api/ready`,
  `/api/chokepoints`, `/api/attribution`, `/metrics`, and the built static
  app with SPA fallback. Path traversal blocked (§14.2); non-GET rejected;
  loopback/local only by design in this phase.
- **Prometheus endpoint (§13.1)**: `src/telemetry/metrics.ts` — dependency-
  free registry rendering the text exposition format with BOUNDED labels
  (route enums, status classes, §8.4 rejection categories; never entity ids
  or user text). HTTP request/error counters live at the server boundary;
  evidence-bundle/claim/agent counters are incremented in the agent
  pipeline.
- **Structured logs (§13.3)**: `src/telemetry/logger.ts` — one-line JSON
  with correlation id, request id, result status, duration, error class,
  route. Redaction is structural: key/token/authorization patterns are
  scrubbed from messages and string fields; there is no field for keys or
  transcripts.
- Verified end-to-end on the built app: `health ok/alive`, `ready 200 true`
  with 3 honest source reports, profiles list, metrics scrape containing
  request counters, SPA index served, 405 on POST. 268 tests.
- **Prometheus + Grafana + Docker Compose (§16.1, §17 Phase 5)**:
  `observability/prometheus.yml` scrapes `app:8787/metrics`;
  `observability/grafana/` provisions the two §13.2 dashboards (Source
  Health, Analytics Quality) from files with a Prometheus datasource;
  `docker-compose.yml` brings up app + Prometheus + Grafana in fixture mode
  with NO credentials in the repo (Grafana anonymous VIEWER for the local
  demo, signup disabled). Multi-stage `Dockerfile` builds the app and ships
  `dist/ + src/ + fixtures` behind `npm run serve`; container healthcheck
  gates Prometheus startup. VERIFIED LIVE: `docker compose up -d` -> app
  healthy, Prometheus target `up = 1`, Grafana ok.
- **Security review (§14)**: `docs/security-review-2026-09-10.md` — 10 PASS
  checks (no credentials in repo, SW cross-origin never cached, server
  traversal guard, key hygiene, bounded labels, log redaction, no provisioned
  Grafana password) and 2 accepted residual notes (local-only exposure;
  container runs as root — both fine for the local demo, required review
  before public hosting per §16.2).
- **Clean-machine setup (README)**: Docker one-command stack, bare-Node
  serve, and the full dev command list. Documentation matches runtime
  behavior (commands verified on this machine).
- **Product README + case study (§17 Phase 5)**: `docs/case-study.md` — the
  product story told only through measured artifacts (test counts, evaluation
  reports, perf budgets, live smoke evidence, ops verification), with an
  explicit "what it does not do" section (§14.4 language discipline).
- **Voice session, local keyless path (§4.4, §8.6, Decision 2 satisfied)**:
  `src/agent/voiceSession.ts` — browser Web Speech API (recognition ->
  synthesis) over the SAME evaluator-gated pipeline. No cloud, no key; OpenAI
  Realtime remains the documented hosted-phase option. §8.6 rules enforced:
  UI-action outcomes are spoken as applied ONLY after the caller applies them
  through app state (applied/refused distinguished); pipeline failures speak
  "failed; no answer was generated" (never fabricated); rejected intents
  speak the refusal. Transcripts live in memory for one turn and are NEVER
  persisted (§11.2). UI renders an honest UNAVAILABLE state when the browser
  lacks speech APIs. 8 tests (fake speech surfaces, no browser APIs in CI).
- Phase 5 exit criteria: reproducible build/test path (npm + Docker) MET;
  no credentials or prohibited data in repository (security review) MET;
  metrics scrape successfully MET; local install works in fixture mode MET
  (Docker + bare Node); documentation matches runtime behavior MET.

## Actually built (Phase 0/1)

- Repository scaffold: Vite + TypeScript (strict), module boundary folders from
  §18 stubbed (§9.2), buildable and testable. No CesiumJS, no UI framework.
- Baseline docs: `AGENTS.md`, `CONTRACT.md`, `DATA_SOURCES.md`, `SECURITY.md`,
  `NON_CLAIMS.md`, `STATUS.md` (this file), `README.md`, and ADRs 0001–0007 in
  `docs/decisions/` (Phase 0 architecture decision record).
- Three MVP chokepoint config records (§2.1, §4.3) in `src/config/` with
  **placeholder geometry explicitly flagged and blocked from use**
  (`assertUsableGeofence()` throws).
- Data-driven source registry (§4.3, §6.1): every candidate source documented,
  every terms decision **TBD**, nothing admitted.
- Canonical observation schema (§5.2), truth-state vocabulary (§3.1), and
  normalization/validation in `src/data/observation.ts`: invalid coordinates
  rejected (never clamped), deterministic dedup and total ordering, stable
  provider-scoped entity identity.
- Fixture loader (§6.2, §12.2) with a hard SIMULATED provenance guard: a
  manifest without `truthState: "SIMULATED"`, `simulated: true`, and a
  `simulated*` provider id cannot load.
- Eleven checked-in SIMULATED fixtures covering §12.2: normal transit,
  stationary anchorage, port entry/exit, missing intervals, duplicates,
  out-of-order timestamps, classification change, source outage, stale cache
  fallback, conflicting sources, and malformed inputs.
- Source health state machine (`src/data/sourceHealth.ts`): FRESH / STALE /
  DEGRADED / UNAVAILABLE / NEVER_ANSWERED with deterministic, timestamped
  transitions, time drift (FRESH decays to STALE), and honest empty-state
  handling (§6.2).
- Source adapter contract (§5.1) in `src/data/sourceAdapter.ts`, provenance
  records (§3.2) in `src/data/provenance.ts`, and `FixtureSourceAdapter`
  implementing the full lifecycle (`enable/refresh/getStatus/getRecords/
  getAttribution/destroy`) on the deterministic fixture timeline.
- 68 Vitest tests across normalization, coordinate rejection, ordering, dedup,
  entity identity, fixture provenance guard, config guards, health
  transitions, adapter lifecycle, and provenance — all green.
- `npm run dev/build/test/lint` scripts; GitHub Actions CI (lint + test + build
  on push).
- Keyless guarantee: no code path reads a provider credential (§6.2, §16.1).

## Phase 3 visual QA milestone: satellite basemap + verified on-canvas rendering

- **Default map stack switched to keyless Esri World Imagery** (user decision,
  best available resolution without credentials); offline Natural Earth II
  remains the automatic no-network fallback (§6.2). Both stay keyless.
- **Pixel-based visibility assertion** (`npm run qa:browser`): the QA projects
  every vessel point to screen coordinates and samples the WebGL canvas —
  29/29 points render their color. (drillPick misses ground-clamped points;
  pixels are authoritative. `preserveDrawingBuffer` was required for honest
  screenshots — without it, WebGL composites blank post-frame.)
- Fixed on the way: `showObservations` wiped fence entities each frame
  (fences now survive); oblique (-45°) camera framing landed the visible
  center height*tan(45°) off the fence — framing is now top-down with the
  destination as the frame center; fence boundaries render as polylines
  (Cesium surface-polygon outlines are unsupported in browsers).
- Both chokepoints verified: LB 11 vessels, Singapore 7, satellite imagery,
  fence outlines visible, 0 console/page errors. 213 tests.

## Phase 3 QA milestone: both chokepoints verified rendering in-browser

- Playwright e2e (`npm run qa:browser`) asserts the full flow: launcher ->
  investigation for BOTH Long Beach (11 vessels) and Singapore (7 vessels),
  with zero console/page errors, SIM badge visible, attribution rendered.
- Root cause of the earlier "Singapore shows none": the fixture set simulated
  only Long Beach. Added four Singapore fixtures (transit, a 4-vessel
  anchorage waiting cohort, entry/exit, 3-hour gap), all membership-verified
  inside the reviewed `singapore-roadstead@2026-09-09-v1` fence. Suez remains
  intentionally without fixtures (its live coverage is UNKNOWN per §6.1; the
  UI shows the honest UNKNOWN/empty state).
- 213 tests. Known cosmetic limit: the offline Natural Earth II base map is
  blurry at chokepoint zoom (whole-earth texture); keyless Esri satellite
  stack is available in the map registry.

## Phase 3: Cesium product surface (in progress)

- **CesiumJS 1.145 integrated keyless** (ADR-0003, §4.1, §6.2): no ion token,
  bundled Natural Earth II offline imagery as the default base layer, keyless
  Esri/OSM stacks in a data-driven map-stack registry (each with required
  attribution, §15). Runtime assets copied to /cesium/ (vite-plugin-static-copy).
- **Working application, not a hero page (§9.3)**: mission launcher →
  investigation (globe + freight HUD + event cards + timeline + evidence
  drawer). Vanilla DOM over pure view models (§9.1: no framework).
- **Freight HUD (§4.2)**: all six §7 component metrics as cards with the
  §9.3 badge vocabulary (LIVE/DERIVED/ESTIMATE/SIM/STALE/UNKNOWN) and the SIM
  badge always visible in fixture mode (§3.1). Baseline comparison lines under
  the cards carry the named baseline window (§8.4 COMPARISON semantics).
- **Mission launcher**: cards from the config registry (§4.3); Suez renders
  "coverage UNKNOWN" per the §6.1 smoke evidence — never a fake empty live view.
- **Timeline/replay**: deterministic controller (fixed-tick advance, no wall
  clock); replay window = deterministic 30-min look-back; §12.5 determinism
  tested (same steps → identical cursors; clamps at window end).
- **Event cards (§2.2)**: bounded via the render governor; threshold-crossing
  language only, with the comparison context line (§8.4).
- **Evidence drawer (§4.5)**: metrics + formulas + comparisons + provenance +
  profile limitations, assembled from data only (no causal text — tested).
- **Share links (§11.2)**: URL-hash encoding of chokepoint/window/replay/
  selections/overlays; no secrets by construction (tested); corrupt links
  degrade to the launcher, never a half-broken state.
- **Render governor (`render-governor-v1`, §12.5)**: bounded, deterministic
  cohort selection with explicit budgets (800 points/40 labels/6 event cards)
  and frame-stability checks — same input, same cohort, no flicker.
- **Theme**: CSS custom properties per §9.3 (dark slate/navy, sea blue,
  red reserved for degraded states); attribution bar always visible; §9.4
  responsive grid prioritizes event cards + evidence on mobile.
- **Browser-safe data path**: the manager accepts preloaded manifests
  (import.meta.glob) so node:fs stays out of the browser bundle (dynamic
  import only on the node path); the SIMULATED fixtures travel with the bundle.
- 212 tests (unit + happy-dom UI render tests). Build: 4.2 MB bundle
  (Cesium runtime; gzip ~1.1 MB), sourcemaps on.

## Live smoke evidence (first §6.1 coverage data, 2026-09-09)

- 5-minute live window (`research/smoke/smoke-run-2026-09-09.log`, key from
  gitignored `.env`, never logged): **571 accepted records, 123 classified
  entities, 36 freight-classified**.
- Candidate vessels per chokepoint (bbox-level, NOT official coverage stats):
  Long Beach anchorage 22, Long Beach approach 14, Singapore corridor 184,
  Singapore roadstead 102, **Gulf of Suez 0, Port Said 0**.
- Interpretation: LA/LB and Singapore have healthy community coverage; Suez
  showed none in this short window — consistent with ADR-0010's live-only
  caveat. Longer windows required before calling Suez "uncovered" (§6.1);
  Phase 3 should present Suez with an explicit coverage-unknown state.
- Integration bugs found and fixed by the smoke process (committed earlier):
  AISStream BoundingBoxes are **[lat, lon]** (settled by live probe; the
  provider README example is symmetric and cannot disambiguate) and frames are
  **binary WebSocket frames** (binaryType=arraybuffer). The second run failed
  due to a transient DNS outage (same window that broke a git push), not code.

## Live AIS adapter (AISStream transport)

- `src/data/aisStreamAdapter.ts`: full §5.1 lifecycle over a real WebSocket —
  subscription with bounding boxes DERIVED from the reviewed fences and the
  documented message-type filter, exponential-health integration via the
  Phase 1 state machine, bounded in-memory buffer (max 5000 records, 72h TTL,
  never persisted — ADR-0010), dedup + canonical ordering on read.
- Coordinate-order pitfall handled explicitly: the provider's BoundingBoxes are
  **[lon, lat]** pairs (verified from aisstream/example) while our rings are
  [lat, lon]; `boundingBoxesFromFences()` converts and is tested against the
  swapped-values failure mode.
- Key hygiene (§14.1): the key is host-supplied, appears ONLY in the
  subscription payload, and never in attribution/status/diagnostics/logs.
  Missing key -> honest UNAVAILABLE with a fixture-fallback hint (§6.2).
- Transport is injected: all tests use a fake socket; **no test touches the
  network**, so CI remains keyless.
- `scripts/aisstream-smoke.ts` + `npm run smoke` (LOCAL ONLY, real key +
  network): bounded smoke window reporting accepted/rejected counts and
  candidate records per chokepoint bbox for §6.1 coverage evidence.
- Phase 2 exit criteria now fully met, including the §12.6 evaluation artifact
  (see the Baselines section and `evaluation-reports/`).

## Baseline comparison + event detector (Phase 2 near-complete)

- `src/analytics/baselines.ts` (`baseline-comparison-v1`, §7/§8.4): like-metric
  comparison (same type AND unit enforced), absolute + relative change,
  direction, null-or-LOW_SAMPLE -> UNKNOWN (never a confident estimate, §3.3),
  zero-baseline relative change documented as undefined, parent quality state
  propagates. The comparison is itself a §5.5 DerivedMetric whose inputs are
  the two parent metric ids.
- `src/analytics/events.ts` (`event-detector-v1`, §4.5/§17): versioned rule
  records (§4.3 data-driven) — queue_buildup (dwell cohort increase),
  stoppage (moving fraction decrease), flow_surge / flow_drop (entry count).
  Fires only when BOTH relative and absolute thresholds are met; UNKNOWN
  comparisons never fire; detector-level default sample floor of 3 observations
  per side (§12.3 minimum sample behavior). Events carry NO causal or
  explanatory text — explanation belongs to the Phase 4 evaluator (§8, §14.4).
- `src/analytics/detectorMetrics.ts` (`detector-metrics-v1`, §12.3): precision,
  recall, F1, false positives per entity-hour, and mean detection latency with
  one-to-one labeled matching (closest match within a window).
- `tests/evaluation/detector.evaluation.test.ts`: a labeled, deterministic
  five-scenario suite (ground truth documented in-file) demonstrating TP/FP/FN
  accounting — 3 TP, 1 FN (a real queue on an insufficient baseline, correctly
  refused), 0 FP — plus an over-firing case showing precision degradation.
- ~~Remaining for Phase 2 exit~~ — DONE: `npm run eval`
  (scripts/run-evaluation.ts) regenerates `evaluation-reports/` from the same
  shared labeled scenarios the tests assert; report committed with documented
  known failures (precision 1.0, recall 0.75, F1 0.857 on the v1 suite).

## AIS normalization (Phase 1 deliverable complete)

- `src/data/ais.ts`: AISStream WebSocket frame → canonical TransportObservation.
  Pure and keyless: no connection, no key reads (transport belongs to the future
  live adapter). Verified frame shape against aisstream/example (2026-09-09).
- Classification `ais-classification-v1`: ITU ship-type codes 70–79 →
  cargo_vessel, 80–89 → tanker, other codes → confirmed non-freight (visible
  context), code 0/missing → UNKNOWN (UNCLASSIFIED cohort). Bulk carriers are
  NOT separable from cargo via type codes — documented, not invented (§2.1).
- Per-entity classification cache merges ShipStaticData into later
  PositionReports; the cache holds only the derived triple, never raw frames
  (ADR-0010).
- AIS sentinels handled per ITU-R M.1371: SOG 102.3, Heading 511, COG 360
  mean "not available" and are OMITTED (missing ≠ zero, §3.3/§7.2).
- Invalid coordinates, missing MMSI/time_utc, and unparseable timestamps are
  rejected with reasons — never clamped (§3.3). 21 tests cover the normalizer.

## Geometry v1 + geofence-bound metrics (ADR-0011, 2026-09-09)

- All six candidate fences APPROVED by the review owner and committed as
  reviewed geometry `2026-09-09-v1` in `src/config/chokepoints.ts` (per-vertex
  provenance in `research/geofence-candidates.md`; weaknesses carried as
  profile limitations).
- `REVIEWED_GEOFENCE_REGISTRY` now contains the six fences (built from config,
  single source of truth); membership re-validates status at point of use.
- **vessel_count v1** (§7.1): unique classified entities with an accepted
  observation inside the reviewed fence; UNCLASSIFIED entities excluded from
  the count but reported in coverage; empty population = UNKNOWN.
- **entry/exit v1** (§7.3): boundary crossings from consecutive observations;
  gaps beyond maxGapSeconds are excluded from counts and reported as
  uncertain — never silently counted.
- All §7 component metrics except baseline comparison and the composite index
  are now implemented and tested (111 tests).

## Geofence registry machinery (§5.4, ADR-0007)

- `src/data/geofences.ts`: full §5.4 reviewed-geofence record (id, purpose,
  geometry version, CRS, effective date, inclusion rule, review owner,
  source/rationale), ring validation (reject, never clamp), even-odd ray-casting
  membership, and a metrics-compatible membership predicate.
- `REVIEWED_GEOFENCE_REGISTRY` is EMPTY by design: production membership stays
  blocked until the review owner (ChrisSchmidt/PCSchmidt) approves candidate
  geometry from `research/geofence-candidates.md`.
- Candidate research complete for all six fences (12 tests cover the machinery
  with a synthetic test-reviewed polygon only).

## Phase 2 progress (fixture-mode, non-geometric slice)

- Track segmentation (`src/analytics/tracks.ts`, §5.3): gap-based segmentation,
  zero interpolation (interpolatedPointCount always 0 — no synthetic positions),
  worst-source-state aggregation.
- Classification rules (`src/analytics/observations.ts`, §3.3): most recent
  accepted observation wins; unreliable classifications are UNCLASSIFIED and
  excluded from type-specific freight totals.
- Metrics (`src/analytics/metrics.ts`, §7.2/§7.4): moving_fraction v1 (missing
  speed excluded, never counted as stopped; empty eligibility = null + UNKNOWN)
  and dwell_estimate v1 (injected membership predicate; min-observations and
  max-gap constraints; conservative longest-visit split). Both are §5.5
  DerivedMetrics with formula versions, explicit inputs, and provenance via
  per-provider records (§3.2; multi-provider conflicts stay visible).
- Geofence-bound metrics (vessel_count, entry/exit) deliberately not started —
  they need reviewed geometry (ADR-0007). Baselines/events/evidence modules are
  pinned stubs.

## Decisions recorded since the last status entry

- Code is MIT (`LICENSE`, ADR-0009); data licensing stays per-source.
- Working name confirmed as "Chokepoint" (ADR-0008).
- Geofence geometry review owner designated: ChrisSchmidt (GitHub: PCSchmidt);
  candidate polygons under research in `research/geofence-candidates.md`.
- AIS provider research COMPLETE (`research/ais-provider-research.md`,
  2026-09-09): AISStream recommended for the portfolio demo with documented
  risk-acceptance (it publishes no data-use terms); alternatives assessed
  (AISHub infeasible, ais.fm defunct, Datalastic/MarineTraffic paid); free
  historical baselines exist only for US (NOAA) and Danish (DMA) waters.
  Admission decision pending with the human.

## Known open items

- ~~Real geofence coordinates~~ — **DONE 2026-09-09 (ADR-0011)**: all six
  fences approved and committed as reviewed geometry v1. Known weaknesses
  (Malacca corridor all-approx, SCA Zone 1 typo) are recorded as limitations
  and candidates for a v2.
- ~~AIS provider terms decision~~ — **DECIDED 2026-09-09 (ADR-0010)**:
  AISStream admitted as a documented risk acceptance (no published data-use
  terms); three MVP chokepoints unchanged (Suez/Malacca live-only, accepted);
  account creation approved as a Phase 2 action.
- No live source adapter exists (by design until the terms decision).
- Rendering of health states (Phase 1 criterion "render correctly") waits for
  the Phase 3 UI; the machine and statuses are implemented and tested.

## GitHub Pages deployment (2026-09-10): relative-base static build

- The app now builds with Vite `base: "./"` so it boots at ANY hosting path
  (domain root or the Pages project subpath `/chokepoint_app/`). Hand-written
  runtime paths (`CESIUM_BASE_URL` in vite.config/main.ts, SW registration)
  derive from `import.meta.env.BASE_URL`; `index.html` public-asset links stay
  absolute in source and are rebased by Vite (relative in the emitted HTML).
- Verified BOTH ways before deploy: local preview at `/` (29/29 pixel QA)
  and a Pages-style subpath simulation at `/chokepoint_app/` (40/40 points,
  manifest/icon 200, zero page errors, zero failed requests).
- `.github/workflows/deploy.yml`: build -> upload `dist/` -> deploy via the
  built-in GITHUB_TOKEN (Pages permissions only, id-token write). Pages
  enabled with `build_type=workflow`; HTTPS enforced. Site:
  https://pcschmidt.github.io/chokepoint_app/
- **LIVE VERIFICATION** (https://pcschmidt.github.io/chokepoint_app/): HTTP
  200, launcher renders, Long Beach 11 / Singapore 7 vessel counts match the
  local app, Suez renders coverage-UNKNOWN, 40/40 vessel pixels on-canvas,
  SIM badge + attribution visible, service worker registered, zero failed
  requests, zero page errors. Screenshots: research/qa/pages-live-*.png.
- The static demo is deliberately the SPA + bundled fixtures only: /api/*,
  /metrics, Prometheus, and Grafana remain the LOCAL ops story
  (`docker compose up`) — the browser app has no calls to them (§10.1/§16.2
  boundary). A custom domain later is a DNS change + Pages setting; the
  relative build needs no changes for it.

## Phase 6 decision (2026-09-10): hold, beta on the static fixture build

- `docs/phase6-beta-decision.md` evaluates the six §17 Phase 6 questions
  against measured evidence. Decision: **hold on data purchase, durable
  infrastructure, and native mobile**; run a limited beta by publishing the
  static fixture-mode build and observing §17 Q1–Q3. Documented triggers
  (first-use sessions, live-data validation, alert-driven return visits)
  would reopen each deferred path. The two user-facing questions
  (understanding without explanation; evidence-drawer trust) are honestly
  marked unanswerable without observed first-use.

## Multimodal admission gate (2026-09-10): decisions recorded, adapters NOT started

- Per the design note's ordering, source research and §6.1 admission-gate
  decisions were completed BEFORE any adapter/config work, and this phase
  STOPS at the checkpoint.
- **Air — adsb.lol ADMITTED with documented risk acceptance (ADR-0012)**:
  free API, ODbL v1.0 for the API and all public data (VERIFIED in the
  provider's OpenAPI license field); live probe of `/v2/lat/lon/dist`
  confirmed aircraft position/kinematics/type/registration fields mapping
  onto `TransportObservation`. OpenSky was evaluated and REJECTED for live
  use: its terms require a written agreement for ANY operational REST API
  integration, even non-profit (VERIFIED). Operator classification is
  inferred-only (callsign/registration heuristics over provider-published
  metadata) — the same "not separable from broadcast data alone" discipline
  as bulk carriers.
- **Land — CBP Border Wait Times ADMITTED (ADR-0013)**: CBP's own
  `bwt.cbp.gov/api/waittimes` verified live with all 85 US crossings
  (El Paso BOTA/PDN/Ysleta included), **keyless**, US-gov public-domain
  basis. Wait times are OBSERVED facility metrics; api.trade.gov + free
  api.data.gov key recorded as fallback. Update cadence is per-port and
  periodic — hours-stale readings at quiet crossings are normal, not
  failures.
- **Rail — DEFERRED (ADR-0014)**: only the static FRA Grade Crossing
  Inventory (Form 71) exists publicly; no live blockage/delay feed. Permitted
  as future static context only, never a movement signal.
- **Data model — FacilityMetric record decided (ADR-0015)**: facility-level
  signals enter as a separate model alongside `TransportObservation` (the
  design note's option b), with the same §3.1–3.3 provenance/truth-state
  contracts. Wait times are OBSERVED facility values, never mixed into
  entity totals; synthetic entities (option c) rejected outright.
- `DATA_SOURCES.md` rows and `SOURCE_REGISTRY` updated with real decisions
  (no TBD left on these rows); config tests assert the new admission state.
- Raw research evidence archived under `research/sources/raw/` (CBP sample
  with all 85 crossings — the future fixture base, api.data.gov developer
  manual, BTS catalog extract).
- **This phase deliberately built NO adapters, no profiles, no UI, no agent
  surface, no rail fixtures** — the checkpoint before implementation, per the
  design note.

## Multimodal implementation (2026-09-10): fixture-first core complete, one location per mode

Following the admission-gate checkpoint (ADRs 0012–0015), the multimodal
extension is implemented fixture-first. **What exists: one air profile and one
land profile, each with placeholder geometry awaiting human review.**

- **FacilityMetric model** (`src/data/facilityMetric.ts`, ADR-0015): an
  OBSERVED facility reading record (facilityId, laneGroup/metric/value
  measurements, verbatim provider update label, port status) with the same
  §3.1–3.3 contracts as TransportObservation — closed vocabularies,
  reject-never-clamp, deterministic dedupe/order. 13 tests. Facility data and
  entity data NEVER mix (maritime snapshots carry no facility metrics and
  vice versa — tested).
- **CBP Border Wait Times fixture** (`tests/fixtures/cbp-border-wait-el-
  paso.json`): SIMULATED fixture derived from the real CBP sample archived
  2026-09-10 (El Paso BOTA + Ysleta, commercial/passenger/pedestrian lanes).
- **CBP live adapter** (`src/data/cbpWaitTimesAdapter.ts`, ADR-0013): polls
  the keyless bwt.cbp.gov endpoint with an INJECTED fetch (no network in CI),
  transforms real crossings into FacilityMetrics, reports partial/failure
  honestly, keeps the latest reading per facility. 9 tests over the archived
  real sample.
- **adsb.lol live adapter** (`src/data/adsbLolAdapter.ts`, ADR-0012): polls
  the point API into mode-"air" TransportObservations with position/
  kinematics; freight-operator cohorts are INFERRED from documented callsign
  heuristics over provider-published metadata — never "confirmed"; bounded
  buffer + TTL per the ODbL posture; seen_pos gives second-precision
  observedAt. 7 tests.
- **Config profiles** (`src/config/chokepoints.ts`): `lax-cargo-air` (air) and
  `el-paso-border-crossings` (land) with PLACEHOLDER geometry — they are
  excluded from the reviewed-fence registry and block metric computation by
  design (the ADR-0007 human-approval gate is intact). Launcher coverage
  language is mode-aware (AIS / ADS-B / border-wait).
- **Manager snapshots**: land profiles serve facility readings keyed by
  facilityId (no membership); air serves an honest empty state with an
  ADR-0007 notice; entity metrics under placeholder geometry are UNKNOWN,
  never zero.
- **Agent surface**: wait-time and cargo-flight questions parse (with a real
  "how long"→"Long Beach" word-collision regression found and fixed); land
  answers carry OBSERVED facility values with provenance; air answers state
  the geometry gate. The evaluator checks facility numbers against the
  metric map — a fabricated wait time is rejected (groundedness 25/25).
- **NOT built (honest scope)**: reviewed geometry for either profile (the
  deliberate human gate); live wiring into the app manager (the live
  adapters exist and are tested but the browser app runs fixture-mode);
  aircraft/truck corridor visualization; rail (deferred, ADR-0014).

## Multimodal decisions 2–3 progress (2026-09-10)

- **Decision 1 (geometry review) — PACKAGE PREPARED, awaiting the review
  owner**: candidate geometry for both multimodal profiles added to
  `research/geofence-candidates.md` (§7 El Paso BOTA/Ysleta frames, §8 LAX
  cargo approach box), with OSM-verified crossing/aerodrome points [OSM] and
  APPROX extents flagged for review. Placeholder geometry stays blocked until
  ChrisSchmidt approves v1 (ADR-0007 gate — deliberately not self-approved).
- **Decision 2 (live wiring) — CBP LIVE LAYER WIRED**: the manager accepts a
  keyless CbpWaitTimesAdapter; land profiles prefer LIVE readings with honest
  SIMULATED-fixture fallback; `health.cbp` surfaced per snapshot; maritime
  snapshots untouched. Air stays unwired until geometry review (its metrics
  need reviewed fences for membership). 4 wiring tests (321 total).
- **Decision 3 (beta) — channel added**: a plain "Feedback" link (GitHub
  Discussions) in the attribution bar — no tracking, no identifiers
  (§13.1/§14.3). The beta decision memo records the published site.

## Deliberately deferred (per §17 roadmap)

- **Phase 2 remainder** — baseline comparison, event detector + §12.3
  detector metrics, evaluation report. Component metrics (tracks,
  classification, moving fraction, dwell, vessel count, entry/exit) are done.
- **Phase 3 remainder** — browser QA (Playwright, §12.5 budgets), replay
  performance profiling, watchlist surface, PWA polish. The core investigation
  UI, globe, launcher, HUD, timeline, event cards, evidence drawer, share
  links, and responsive layout are built (212 tests).
- **Phase 4** — agent/evaluator layer and voice (Decision 2, §19).
- **Phase 5** — Docker, Prometheus/Grafana, extended observability.

No live provider integration and no LLM work exists in this repository.
