# Chokepoint

[![CI](https://github.com/PCSchmidt/chokepoint_app/actions/workflows/ci.yml/badge.svg)](https://github.com/PCSchmidt/chokepoint_app/actions/workflows/ci.yml)

Provenance-aware transportation intelligence for global maritime chokepoints.
Every observation, metric, and generated answer carries an explicit truth state
(`OBSERVED` / `DERIVED` / `SIMULATED` / `UNKNOWN`) and provenance.

**Status:** Phases 0–4 complete; Phase 5 (ship and observe) in progress.
Fixture mode only: no credentials required, no live provider integration in
the UI path, no LLM. See `STATUS.md` for what is actually built and
`CHOKEPOINT-PLAN.md` for the full plan.

## Clean-machine quick start (§16.1)

Prereqs: Node 24 and npm (or Docker — no other prereqs).

### Option A — local Docker stack (fixture mode, one command)

```bash
docker compose up -d
# app:       http://localhost:8787   (SPA + API + metrics)
# readiness: http://localhost:8787/api/ready
# prometheus: http://localhost:9090  (target: app:8787 -> up)
# grafana:   http://localhost:3000   (pre-provisioned §13.2 dashboards)
docker compose down   # tear everything down
```

No credentials required — the app runs on checked-in SIMULATED fixtures.

### Option B — bare Node

```bash
npm install
npm run build
npm run serve        # serves dist/ + /api/* + /metrics on :8787 (PORT to override)
```

### Development

```bash
npm install
npm run dev          # vite dev server
npm test             # vitest (deterministic domain + evaluation suites)
npm run lint         # tsc --noEmit
npm run eval         # detector evaluation report (§12.6)
npm run eval:agent   # agent groundedness report (§12.4)
npm run perf:replay  # replay performance budgets (§12.5) — needs a display for the browser
npm run qa:browser   # Playwright end-to-end visual QA
```

Optional live AIS smoke (LOCAL ONLY, requires your own AISStream key in
gitignored `.env`): `npm run smoke`.

## Current state

- All data on screen is checked-in `SIMULATED` fixtures — no credentials, no
  network calls (§6.2, §16.1). The SIM badge is always visible in fixture mode.
- Three MVP chokepoints (Long Beach, Singapore/Malacca, Suez) with reviewed
  geofence geometry v1 (ADR-0011); Suez honestly renders coverage UNKNOWN.
- Working investigation UI: keyless Cesium globe, freight HUD, deterministic
  replay, event cards, evidence drawer, share links, watchlist (Workflow E).
- Verified agent (§8): typed intents over the §4.4 allowlist, deterministic
  tools, evidence bundles, claim evaluator v1, text query surface. Unsupported
  claims are rejected or caveated; groundedness report 19/19 (`npm run eval:agent`).
- PWA: installable, offline app shell after first load.
- Observability: `/api/health`, `/api/ready`, `/metrics` (Prometheus), JSON
  logs with redaction; Grafana dashboards provisioned in the Docker stack.
- Voice is deferred by Decision 2 (evidence before voice).

## Key documents

- `CHOKEPOINT-PLAN.md` — planning baseline (source of truth)
- `CONTRACT.md` — canonical data contracts
- `DATA_SOURCES.md` — source matrix and admission gate (all terms decisions TBD)
- `AGENTS.md` — generator/evaluator contract
- `NON_CLAIMS.md` — what the product does not claim (user-facing)
- `SECURITY.md` — secrets, proxy, and privacy rules
- `STATUS.md` — measured progress log
- `docs/case-study.md` — the product story with measured results
- `docs/phase6-beta-decision.md` — the Phase 6 public-beta decision memo
- `docs/decisions/` — architecture decision records (ADRs)
- `research/` — candidate-geometry and provider-terms research (pre-decision)

## License

Code: MIT (see `LICENSE`). Data licenses are separate per source; all current
fixture data is synthetic (`SIMULATED`, CC0-1.0 declared in provenance).
