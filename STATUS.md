# STATUS.md — What Is Actually Built

This file records measured progress and known limitations, not optimistic
completion claims. Claims here must match the repository.

**Phase 0 in progress. Phase 1 substantially complete (fixture-mode scope).**

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
- AIS provider terms research in progress in `research/ais-provider-research.md`
  (portfolio-demo-only scope; account creation acceptable).

## Known open items

- Real geofence coordinates for all three chokepoints — candidate polygons
  under research (`research/geofence-candidates.md`), pending review by the
  designated owner; placeholders still blocked from computation (ADR-0007).
- AIS provider terms decision (AISStream or alternative) — research in
  progress; decision TBD (§6.1, §20 step 3).
- No live source adapter exists (by design until the terms decision).
- Rendering of health states (Phase 1 criterion "render correctly") waits for
  the Phase 3 UI; the machine and statuses are implemented and tested.

## Deliberately deferred (per §17 roadmap)

- **Phase 2** — maritime analytics: track segmentation, geofence entry/exit,
  moving fraction, dwell estimate, baseline comparison, event detector,
  evaluation report. Blocked on reviewed geofence geometry for
  membership-dependent metrics; non-geometric metrics could start on fixtures.
- **Phase 3** — Cesium globe, freight HUD, mission launcher, timeline/replay,
  evidence drawer, share-link state, health-state rendering.
- **Phase 4** — agent/evaluator layer and voice (Decision 2, §19).
- **Phase 5** — Docker, Prometheus/Grafana, extended observability.

No live provider integration and no LLM work exists in this repository.
