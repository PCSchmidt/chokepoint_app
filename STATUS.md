# STATUS.md — What Is Actually Built

This file records measured progress and known limitations, not optimistic
completion claims. Claims here must match the repository.

**Phase 0 complete. Phase 1 complete. Phase 2: component metrics, baseline comparison, and event detector complete; evaluation report artifact remains.**

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
- Remaining for Phase 2 exit: packaging these results into the first
  reproducible evaluation report artifact (§12.6, §20 step 8).

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

## Deliberately deferred (per §17 roadmap)

- **Phase 2 remainder** — baseline comparison, event detector + §12.3
  detector metrics, evaluation report. Component metrics (tracks,
  classification, moving fraction, dwell, vessel count, entry/exit) are done.
- **Phase 3** — Cesium globe, freight HUD, mission launcher, timeline/replay,
  evidence drawer, share-link state, health-state rendering.
- **Phase 4** — agent/evaluator layer and voice (Decision 2, §19).
- **Phase 5** — Docker, Prometheus/Grafana, extended observability.

No live provider integration and no LLM work exists in this repository.
