# STATUS.md — What Is Actually Built

This file records measured progress and known limitations, not optimistic
completion claims. Claims here must match the repository.

**Phase 0 in progress.**

## Actually built (Phase 0/1)

- Repository scaffold: Vite + TypeScript (strict), module boundary folders from
  §18 stubbed (§9.2), buildable and testable. No CesiumJS, no UI framework.
- Baseline docs: `AGENTS.md`, `CONTRACT.md`, `DATA_SOURCES.md`, `SECURITY.md`,
  `STATUS.md` (this file).
- Three MVP chokepoint config records (§2.1, §4.3) in `src/config/` with
  **placeholder geometry explicitly flagged and blocked from use**.
- Canonical observation schema (§5.2) and normalization/validation in
  `src/data/observation.ts`; fixture loader (§6.2 keyless-first) in
  `src/data/fixtureLoader.ts`.
- Synthetic fixtures in `tests/fixtures/` labeled `SIMULATED`: normal transit,
  stationary anchorage, port entry/exit, missing position intervals, duplicate
  records, out-of-order timestamps.
- Vitest deterministic domain tests (§12.1 subset): normalization, invalid
  coordinate rejection, timestamp ordering, duplicate handling, entity identity
  stability — all green.
- `npm run build / test / lint` scripts; GitHub Actions CI (install + lint +
  test + build on push).
- Keyless guarantee: no code path reads a provider credential (§6.2, §16.1).

## Known open items

- Real geofence coordinates for all three chokepoints — placeholder only; must
  be reviewed and versioned before any membership computation (§5.4, §20 step 4).
- AIS provider terms decision (AISStream or alternative) — TBD; blocks any live
  integration (§6.1, §20 step 3).
- Source adapter lifecycle interface, provenance records, source health state
  machine — Phase 1 deliverables, in progress.
- Track model, geofence registry, and malformed-input hardening beyond the
  current test set.

## Deliberately deferred (per §17 roadmap)

- **Phase 2** — maritime analytics: track segmentation, geofence entry/exit,
  moving fraction, dwell estimate, baseline comparison, event detector. The
  geofence geometry is not yet reviewed, so membership-dependent metrics would
  be built on unreviewed data.
- **Phase 3** — Cesium globe, freight HUD, mission launcher, timeline/replay,
  evidence drawer, share-link state. Visual surface waits on stable analytics.
- **Phase 4** — agent/evaluator layer and voice. Evidence-before-voice is
  Decision 2 (§19); the deterministic contract must exist first.
- **Phase 5** — Docker, Prometheus/Grafana, observability configs. Layout
  folders are stubbed only.

No live provider integration and no LLM work exists in this repository.
