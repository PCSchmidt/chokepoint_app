# Chokepoint — Case Study (2026-09-10)

A verified analytical workflow over public transportation signals, built as a
portfolio demonstration of the full AI-engineering lifecycle. This document
states only what is measured in this repository; every claim links to an
artifact or a test.

## The problem

Maritime chokepoints (port approaches, canal corridors) have real, recurring
operational questions: *How many vessels are waiting? Is that unusual? What
evidence supports the claim?* Public AIS data makes raw positions cheap, but
raw positions are not intelligence: they are noisy, incomplete, misclassified,
and easy to over-read.

Chokepoint's central capability is a provenance-aware pipeline:

> **Observe movement → derive operational metrics → compare with a baseline →
> detect meaningful change → explain the result with evidence and uncertainty.**

The trust boundary is explicit: the app distinguishes what a provider reports
(`OBSERVED`) from what it calculates (`DERIVED`) from what is generated for
demonstration (`SIMULATED`) from what cannot be established (`UNKNOWN`). This
distinction is a product feature, not fine print.

## Architecture in one paragraph

A Vite + TypeScript strict app (no frontend framework) over a data layer of
adapter → normalization → health/provenance → deterministic analytics. A
mission launcher opens an investigation: keyless CesiumJS globe, freight HUD of
six component metrics, deterministic replay timeline, threshold-crossing event
cards, and an evidence drawer. A verified agent (typed intents → allowlisted
deterministic tools → evidence bundle → claim evaluator → caveated answer)
answers text questions; a saved-watchlist evaluates thresholds locally. The
§8 generator/evaluator split is structural: the generator renders only
evaluator-accepted claims.

## Key engineering decisions

| Decision | Rationale | Artifact |
|---|---|---|
| Deterministic analytics before any LLM | Every number must be reproducible; the evaluator cannot check what it cannot recompute | ADR-0001, `src/analytics/` |
| Keyless-first | The demo must run without credentials; live sources are opt-in, server-side keys only | ADR-0003/0010, `§6.2` |
| Reviewed geofences as data, not UI conditionals | Membership is a measurement decision with an owner and provenance | ADR-0007/0011, `src/data/geofences.ts` |
| Evaluator cannot be bypassed | The generator accepts a verdict object, not raw claims | `src/agent/generator.ts` |
| Unknown is a first-class answer | Zero observations ≠ zero vessels; absence of evidence is not evidence of absence | `§3.3`, agent tools emit "coverage unknown, not zero" |
| Truth-state badges everywhere | SIM/DERIVED/UNKNOWN are always visible, never silently dropped | `§3.1`, `§9.3` |

## Measured results (fixture mode unless noted)

- **Deterministic core**: 326 tests across normalization, geofence machinery,
  health states, metrics, detectors, adapters, agent, UI render, PWA, and
  server integration — all green in CI without credentials or network.
- **Detector evaluation** (`npm run eval`): v1 labeled suite — precision 1.0,
  recall 0.75, F1 0.857, 0 false positives, with documented known failures
  (`evaluation-reports/`).
- **Agent groundedness** (`npm run eval:agent`): 25/25 scenarios — numeric
  accuracy, provenance coverage, banned-language rejection (THREAT/CAUSE/
  PREDICTION/INTENT), scope-overreach rejection, fabricated-number rejection
  (facility claims included), abstention quality
  (`evaluation-reports/agent-2026-09-10.md`).
- **Replay performance** (`npm run perf:replay`, §12.5 budgets): replay render
  mean ~3.0 ms / p95 ~4.7 ms (budget 33 ms), scrub mean ~128 ms
  (budget 250 ms), zero idle renders, 0.0% heap growth over globe
  mount/unmount cycles.
- **Browser QA** (`npm run qa:browser`): both fixture chokepoints verified
  rendering — 29/29 vessel points confirmed on-canvas by pixel sampling,
  zero console/page errors.
- **Live coverage evidence** (`research/smoke/`): a 5-minute live AISStream
  window accepted 571 records / 123 classified entities; LA/LB and Singapore
  showed healthy community coverage, Suez showed none in that window —
  recorded as coverage-UNKNOWN, not zero.
- **Operations**: `docker compose up -d` brings up app + Prometheus + Grafana
  with no credentials; Prometheus target `up = 1`; readiness and liveness
  endpoints answer honestly. Security review: 10 PASS checks
  (`docs/security-review-2026-09-10.md`). The static fixture-mode demo is
  CI-deployed to https://pcschmidt.github.io/chokepoint_app/ (verified live:
  40/40 vessel pixels, PWA offline shell active).
- **Multimodal (air + land)**: went through the identical admission gate —
  adsb.lol admitted under ODbL (OpenSky rejected on its own terms), CBP wait
  times admitted keyless (verified live, 85 crossings), rail deferred on
  evidence. A separate FacilityMetric model keeps facility signals honest;
  both live adapters are wired into the manager with fixture fallbacks and the
  browser demo stays fixture-mode by design.

## What it deliberately does not do

- No intent, threat, or causal claims — rejected by the evaluator by
  construction, not by prompting (`§8.4`, §14.4).
- No presentation of simulated data as live; the SIM badge is always visible.
- No missing data treated as zero; Suez renders coverage-UNKNOWN.
- No voice claims about visual state that the UI has not confirmed (`§8.6`).
- No live provider integration in the UI path; the live adapter is tested
  against injected transports and stays out of CI.

## What the next phases would add

- The §10.2 hosted API exposing the (already wired and tested) live adapters
  to the browser: a small server-side snapshot endpoint, after which the UI's
  live layers activate without contract changes.
- Historical baselines from permitted retention sources (NOAA/DMA identified
  in `research/ais-provider-research.md`).
- Optional hosted voice (OpenAI Realtime) behind the same evaluator gates;
  the local voice path is keyless browser speech (§8.6).
- Watchlist alerting as a scheduled hosted job (§11.3) — the local-first
  evaluation already exists.

## Honest limitations

- All on-screen data is SIMULATED; the live adapters are wired at the manager
  level (tested) but the browser app never calls them — the browser-live path
  (§10.2 hosted API) is deliberately unbuilt.
- Singapore/Malacca fences are all-approximate pending re-derivation from IMO
  routeing data (v2 geometry candidate); the LAX air box is a regional query
  region, not an FAA sector (a v2 could tighten along published approach
  procedures).
- Bulk carriers are not separable from cargo via ITU type codes, and aircraft
  broadcast no cargo flag — both classification limits are documented, not
  invented; operator cohorts are inferred, never asserted.
- The offline base map is blurry at chokepoint zoom; the keyless Esri stack
  needs network.
- One browser voice path is supported (see the voice layer notes in
  `STATUS.md`); recognition support varies by browser.
