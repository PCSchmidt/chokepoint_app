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
| Live vessel positions | AISStream or another permitted AIS provider | Selected regional vessel observations | API terms, coverage, historical retention | **TBD** (research in progress: `research/ais-provider-research.md`; inspiration repo gods-eye-view uses AISStream.io live) |
| Vessel classification | AIS message fields plus source metadata | Cargo/tanker/bulk filtering | Missing or incorrect classifications | **TBD** |
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
