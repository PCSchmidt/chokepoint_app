# DATA_SOURCES.md — Source Matrix and Admission Gate

Source of truth: `CHOKEPOINT-PLAN.md` §6, §6.1, §15. **Every candidate source
below has a terms decision of TBD.** No source may enter production
configuration until it passes the §6.1 admission gate.

## 1. Candidate source matrix (§6)

The exact source set must be confirmed against current terms before
implementation. This table is an architecture target, not a blanket assertion
that every provider is suitable for commercial redistribution.

| Capability | Candidate source | Initial use | Key risk | Terms decision |
|---|---|---|---|---|
| Live vessel positions | AISStream | Selected regional vessel observations | API terms, coverage, historical retention | **APPROVED (risk-accepted)** — no published data-use terms (verified 2026-09-09); accepted for non-commercial demo per ADR-0010 |
| Vessel classification | AISStream `ShipStaticData` fields plus source metadata | Cargo/tanker/bulk filtering | Missing or incorrect classifications | **APPROVED (same source/decision as AISStream, ADR-0010)** |
| Port/chokepoint context | OpenStreetMap / public geospatial sources | Port geometry and contextual map features | ODbL attribution and derived-database obligations | **TBD** |
| Baseline fixtures | Synthetic tracks plus legally retained observations | Deterministic testing and demos | Must never be presented as live data | N/A — synthetic, labeled `SIMULATED` |
| Air cargo positions | adsb.lol or another permitted feed | Later cargo-aircraft layer | Coverage, terms, operator classification | **TBD** (later phase) |
| Border wait times | CBP or relevant government source | Later land layer | Geographic scope and update reliability | **TBD** (later phase) |
| Traffic flow | Optional TomTom or permitted public source | Later land corridor layer | Proprietary terms and request costs | **TBD** (later phase) |
| Port throughput | Official port/open-data sources | Later contextual metric | Different definitions and reporting cadence | **TBD** (later phase) |

## 2. Data-source admission gate (§6.1)

A source cannot enter production configuration until its record documents:

- [ ] Terms and commercial status.
- [ ] Whether raw data may be stored.
- [ ] Whether normalized/derived data may be stored.
- [ ] Required attribution.
- [ ] Rate limits and quotas.
- [ ] Acceptable caching duration.
- [ ] Coverage and known blind spots.
- [ ] Failure behavior.
- [ ] Removal plan if terms change.

### 2.1 AISStream admission-gate record (completed 2026-09-09, ADR-0010)

- [x] Terms and commercial status — **absence documented**: no data-use terms exist (verified); free; accepted as risk for non-commercial demo.
- [x] Whether raw data may be stored — no written grant; **policy: short-TTL in-memory only (<= 72 h), never committed, never redistributed**.
- [x] Whether normalized/derived data may be stored — no written grant; **policy: derived aggregates and normalized observations only**.
- [x] Required attribution — none stated; **courtesy attribution "Live AIS via AISStream.io" + coverage caveat** (§15).
- [x] Rate limits and quotas — VERIFIED: 3 conns/account, 3 conns/IP, 1 subscription update/s, 200-MMSI filters, bounding-box subscriptions required; Sept 2026 uncompressed-bandwidth caps.
- [x] Acceptable caching duration — **<= 72 h in-memory** (self-imposed; no provider rule exists).
- [x] Coverage and known blind spots — **first empirical evidence 2026-09-09** (5-minute live smoke window, `research/smoke/smoke-run-2026-09-09.log`): Long Beach anchorage 22 / approach 14 candidate vessels; Singapore corridor 184 / roadstead 102; **Gulf of Suez 0 and Port Said 0**. Suez appears effectively uncovered by community receivers in a short window — treat Suez counts as UNKNOWN until longer windows prove otherwise (§3.3: missing data is not zero).
- [x] Failure behavior — VERIFIED: no SLA, no replay, drops on slow consumers, documented reconnect guidance; treat gaps as normal operation.
- [x] Removal plan if terms change — swap adapter, fall back to fixture/NOAA/DMA historical replay; paid provider as last resort (ADR-0010).

## 3. Keyless-first strategy (§6.2)

The MVP runs without optional credentials using:

- Synthetic replay fixtures.
- Small checked-in test fixtures with clear provenance (`SIMULATED`).
- A keyless or locally configured provider where permitted.
- Empty but honest states for unavailable live layers.

A missing provider key must not make the whole application appear broken.
All Phase 0/1 code paths are credential-free; fixtures live in
`tests/fixtures/` and are labeled with `truthState: "SIMULATED"`.

## 3.1 Seed evidence from the inspiration project

`github.com/PCSchmidt/gods-eye-view` (the fork that seeded this project) lists
in its own `DATA_SOURCES.md`: **AISStream.io** for live vessels ("Free, beta,
no formal ToS; AIS is a public broadcast"), **OpenSky Network** (non-commercial
research license) and **adsb.lol** (ODbL 1.0) for flights, and OpenStreetMap
sources (ODbL 1.0) for geometry. This is context, not a terms decision: every
provider's CURRENT terms still require verification against the §6.1 gate
before admission.

## 3.2 Live AIS research findings (2026-09-09 — full report in `research/ais-provider-research.md`)

Verified findings for the §6.1 gate (primary pages only; anything not verifiable is marked UNVERIFIED in the report):

- **AISStream.io**: free WebSocket API (VERIFIED), documented limits (3 connections/account, 3 per IP, 1 subscription update/s, 200-MMSI filters, mandatory bounding-box subscriptions), 25 message types including `ShipStaticData` (vessel classification field Chokepoint needs), no SLA, no replay, drops on slow consumers. Direct browser connections explicitly NOT permitted — key must stay server-side. **Still no data-use terms of any kind** (terms pages 404; only a personal-data privacy policy) — storage/caching/redistribution rules are UNVERIFIED *because they do not exist in writing*.
- **Alternatives evaluated**: AISHub (free but requires operating a receiver and sharing your own raw feed back — infeasible for a software-only demo); ais.fm (**defunct** — domain lapsed to a personal blog); Datalastic (paid; "no derivative databases" clause conflicts with Chokepoint's storage model); MarineTraffic/Kpler (paid, quote-based). Historical baselines: NOAA MarineCadastre (US waters) and Danish DMA (Danish waters) free bulk CSVs; AISStream has NO history.
- **Recommendation (research-level)**: admit AISStream as the first live provider for the portfolio demo, with: honest "no published terms" documentation, minimal raw retention (short-TTL in-memory buffer, never committed), courtesy attribution, backend-only key, and provider-swappability via the Phase 1 adapter interface.
- **Consequence for chokepoint selection**: Suez/Malacca would be live-only (no free historical baselines); US/Danish waters unlock free historical replay for baselines.

**The admission decision is MADE (2026-09-09): AISStream admitted as a documented risk acceptance (ADR-0010).** Conditions: raw messages never committed or redistributed, short-TTL in-memory retention (<= 72 h), server-side key only, courtesy attribution, provider kept swappable, removal plan = fixture/historical replay fallback. Singapore/Malacca and Suez are live-only (owner accepted).

## 4. Licensing and attribution (§15)

Code license and data licenses are separate. **The code is MIT** (see
`LICENSE` and ADR-0009); the MIT grant covers code only, never data. Before adding each source,
record (in this file, per source): provider and dataset, license/terms URL,
commercial-use status, redistribution and caching rules, required attribution,
whether transformed data may be committed, whether screenshots may contain the
data, and a removal or replacement plan.

An open API is never assumed to permit commercial redistribution, long-term
storage, or repackaging. A source acceptable for a local portfolio demo may
require replacement before a commercial launch.
