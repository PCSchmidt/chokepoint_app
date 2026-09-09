# Chokepoint

[![CI](https://github.com/PCSchmidt/chokepoint_app/actions/workflows/ci.yml/badge.svg)](https://github.com/PCSchmidt/chokepoint_app/actions/workflows/ci.yml)

Provenance-aware transportation intelligence for global maritime chokepoints.
Every observation, metric, and generated answer carries an explicit truth state
(`OBSERVED` / `DERIVED` / `SIMULATED` / `UNKNOWN`) and provenance.

**Status:** Phase 0/1 scaffold — fixture mode only. No live provider
integration, no LLM integration. See `STATUS.md` for what is actually built and
`CHOKEPOINT-PLAN.md` for the full plan.

## Commands

```bash
npm install       # install dev dependencies
npm run dev       # vite dev server
npm run build     # tsc --noEmit + vite build
npm test          # vitest (deterministic domain tests, SIMULATED fixtures)
npm run lint      # type-level lint (tsc --noEmit)
```

## Current state

- The app runs entirely on checked-in `SIMULATED` fixtures — no credentials, no
  network calls (§6.2, §16.1).
- The three MVP chokepoints are configured with placeholder geofences that are
  blocked from any membership computation until reviewed coordinates land.
- Cesium globe, analytics engine, agent/evaluator, and voice are deliberately
  deferred to later phases (§17).

## Key documents

- `CHOKEPOINT-PLAN.md` — planning baseline (source of truth)
- `CONTRACT.md` — canonical data contracts
- `DATA_SOURCES.md` — source matrix and admission gate (all terms decisions TBD)
- `AGENTS.md` — generator/evaluator contract
- `NON_CLAIMS.md` — what the product does not claim (user-facing)
- `SECURITY.md` — secrets, proxy, and privacy rules
- `STATUS.md` — measured progress log
- `docs/decisions/` — architecture decision records (ADRs)
- `research/` — candidate-geometry and provider-terms research (pre-decision)

## License

Code: MIT (see `LICENSE`). Data licenses are separate per source; all current
fixture data is synthetic (`SIMULATED`, CC0-1.0 declared in provenance).
