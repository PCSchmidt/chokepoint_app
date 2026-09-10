# Multimodal Source Research — Air Cargo, Border Wait Times, Rail (Admission-Gate Phase)

Date: 2026-09-10
Scope: §6.1 admission-gate evaluation for the multimodal extension (air cargo,
land border wait times, rail crossings) per the design note reviewed with the
product owner. This phase STOPS before any adapter implementation — the same
way the AISStream terms decision (ADR-0010) was a checkpoint before Phase 2.
Method: direct fetches of primary pages only (provider/API documentation,
OpenAPI specifications, US-government data portals). Web search was NOT
available (no Serper key configured), matching the AIS research method.
Raw evidence archived under `research/sources/raw/` (CBP wait-times sample,
BTS catalog response, api.data.gov developer manual).
Status legend: **VERIFIED** = read directly from the provider's own page/API
on 2026-09-10. **UNVERIFIED** = not stated by the provider or unreachable;
do not guess.

---

## 1. Air cargo positions

### 1a. adsb.lol — RECOMMENDED (admit with documented risk acceptance)

Primary evidence: `https://api.adsb.lol/api/openapi.json` (VERIFIED, 2026-09-10),
the provider's own machine-readable API description:

- **Terms**: "You can use the API for free." An API key will be required "in
  the future, which you can get by feeding to adsb.lol" (i.e. no key today).
  "If you want to use the API for production purposes, please contact me so I
  do not break your application by accident."
- **License**: "The license for the API as well as all data ADSB.lol makes
  public is **ODbL**" — `Open Data Commons Open Database License (ODbL) v1.0`
  stated in the OpenAPI `license` field. Same license family as OpenStreetMap.
- **Endpoint shape (VERIFIED by live probe, LAX area)**: `GET
  /v2/lat/{lat}/lon/{lon}/dist/{dist}` returns aircraft with ICAO24 hex, callsign,
  registration, type code, position, baro/geom altitude, groundspeed, track,
  vertical rate, category, NIC/RC/NAC/SIL quality fields. This maps naturally
  onto the existing `TransportObservation` model (position + kinematics +
  quality), like AIS did.
- **Operator metadata**: registration, type code, and (via the metadata
  surface) airline/route are provider-published entity metadata — usable under
  §8.4 IDENTITY only to that extent. See the classification risk below.
- **Rate limits**: UNVERIFIED — no published numeric limit. Risk documented;
  the adapter must cache/poll conservatively (bounded buffer, 10 s+ poll).
- **ODbL obligations (the risk acceptance)**: ODbL is share-alike for
  *databases*. Chokepoint's posture (same pattern as ADR-0010): in-memory
  bounded buffer only, no raw data dumps committed or redistributed, derived
  aggregates displayed in the app are fine, and any future published derived
  database must itself be ODbL. This is a documented obligation, not a
  blocker, for a non-commercial portfolio demo.

### 1b. OpenSky Network — REJECTED for live adapter use (terms barrier)

Primary evidence: `https://openskynetwork.org/about/terms-of-use` (VERIFIED,
2026-09-10). The terms are materially stricter than the Phase 0 note assumed:

- License granted "solely for the purpose of **non-profit research and
  non-profit education**".
- **"Operational REST API use: Use of the REST API in any operational
  capacity — including integration into a live product, service, or automated
  system (even if only internal) — requires a previous written agreement,
  even for non-profit or governmental entities."**

Chokepoint's adapter pattern (an application component polling an API
automatically) is precisely "operational REST API use" as defined here. A
portfolio demo is non-commercial, but the terms require a written agreement
for the *operational* use regardless, and obtaining one is out of scope for
this phase. One-off research pulls would be fine; a product integration is
not. Decision: do not build an OpenSky live adapter. adsb.lol covers the same
capability slot under a genuinely open license.

### 1c. Air operator classification — documented product risk

Aircraft do not broadcast a "cargo" flag (analogous to the ITU type-code
finding for bulk carriers). Filtering to freight operators requires callsign
prefixes (FDX/UPS/GTI/CLX/...), registration databases, or type-code
inference. These are **inferred** classifications at best
(`classification: "inferred"` in the existing model). The agent must never
assert "a FedEx flight" unless the provider publishes the operator for that
aircraft record — provider-published metadata (registration/type/airline
fields from adsb.lol's metadata surface) is the only IDENTITY-permitted basis.

---

## 2. Border wait times (land)

### 2a. CBP Border Wait Times at bwt.cbp.gov — RECOMMENDED (admit; keyless)

Primary evidence: live probe of `https://bwt.cbp.gov/api/waittimes` on
2026-09-10 (raw sample archived at `research/sources/raw/cbp-bwt-sample-2026-09-10.json`):

- **NO API KEY REQUIRED** (VERIFIED — the endpoint answers unauthenticated;
  this beats the api.trade.gov path, which requires a free api.data.gov key
  and whose TLS chain failed validation from this machine on 2026-09-10).
- Coverage: **85 crossings** across the Canadian (30) and Mexican (55)
  borders. El Paso, TX includes Bridge of the Americas (BOTA), Paso Del Norte
  (PDN), and Ysleta — the design note's named target.
- Payload: per-crossing `port_number`, `port_name`, `crossing_name`, hours,
  observation `date`/`time`, `port_status`, and per-lane-group
  `commercial_vehicle_lanes` / `passenger_vehicle_lanes` / `pedestrian_lanes`
  with `delay_minutes`, `lanes_open`, `operational_status`, and lane-level
  `update_time` (e.g. "At 7:00 am EDT").
- **Facility-level, not moving-entity**: this data is a number at a fixed
  facility — the data-model ADR (ADR-0015) defines how it enters the system
  without abusing `TransportObservation`.
- **Terms**: US-government work (17 USC §105 — public domain convention).
  No restrictive data-use terms found on the service. Detailed written reuse
  statement for this specific endpoint: UNVERIFIED (the site is a JS app
  without a linked data-license page). Attribution by convention:
  "U.S. Customs and Border Protection".
- **Update cadence**: lane `update_time` strings suggest periodic manual
  updates per port (e.g. "At 7:00 am EDT"); the response header timestamp is
  per-request. A 10-minute poll with a 30-minute cache is a conservative
  starting point; freshness thresholds must reflect the REAL cadence
  (hours-stale data is normal at quiet crossings, so `freshWithinSeconds`
  must be generous — a naive FRESH threshold would mislabel this source).
- **Geographic scope**: US land borders only (no Canadian-side or Mexican-side
  data; wait times are outbound-bound measures as published).

### 2b. api.trade.gov (ITA platform) — noted alternative, not required

Serves the same CBP data with a free api.data.gov key (default 1,000
requests/hour — VERIFIED in the api.data.gov developer manual). Not needed
while bwt.cbp.gov is keyless; keep as the documented fallback if the direct
endpoint changes.

---

## 3. Rail crossings (FRA)

Primary evidence: BTS/`data.transportation.gov` catalog (VERIFIED,
2026-09-10; archived at `research/sources/raw/bts-catalog-grade-crossing-2026-09-10.json`):

- The FRA **Grade Crossing Inventory System (Form 71)** is available as open
  datasets ("Crossing Inventory Data (Form 71) - Current" `m2f8-22s6`,
  updated 2026-09-10; historical variant `vhwz-raag`).
- **No live blockage/delay feed exists.** The inventory is a static registry
  of crossing characteristics; FRA does not publish live crossing-occupancy or
  delay times. Live rail delay data in the US is proprietary (railroads).
- Conclusion: **defer rail as a live layer**. The Form 71 inventory may serve
  later as *static context* (crossing locations along the simulated truck
  corridors) — but it is not a movement signal and must not be presented as
  one. Simulated truck density remains the only land "movement" layer, and it
  is SIMULATED by design.

---

## 4. Terms matrix — §6.1 checklist (VERIFIED 2026-09-10)

| Checklist item | adsb.lol | OpenSky Network | CBP bwt.cbp.gov | FRA/BTS rail |
|---|---|---|---|---|
| Terms & commercial status | Free (VERIFIED); production use: "contact me" (VERIFIED); ODbL v1.0 for API + all public data (VERIFIED) | Non-profit research/education only; operational REST use requires written agreement (VERIFIED) | US-gov public domain basis; no restrictive terms found (UNVERIFIED detail) | US-gov open data portal (Socrata); public-domain basis |
| Raw storage allowed? | ODbL: store OK with share-alike on published derivatives; keep in-memory per ADR-0012 | N/A (rejected for live use) | Yes (public data; sample archived) | Yes (bulk download) |
| Normalized/derived storage allowed? | Yes; published databases that use the data must be ODbL (VERIFIED license terms) | N/A | Yes | Yes |
| Required attribution | ODbL convention: attribution + license link (see ODbL §4.3; exact wording UNVERIFIED as obligation) | N/A | "U.S. Customs and Border Protection" (convention) | US DOT / FRA attribution (convention) |
| Rate limits | UNVERIFIED (none published) | N/A | UNVERIFIED (none published; poll conservatively) | N/A (bulk/static) |
| Acceptable caching | Bounded in-memory per ADR-0010 pattern | N/A | 30-min cache assumption pending cadence measurement | Static snapshot |
| Coverage & blind spots | Community receivers; gaps away from populated areas/feeder density (UNVERIFIED detail, expected) | N/A | US land borders only, 85 crossings (VERIFIED count); lane updates vary in age | National inventory (static) |
| Failure behavior | Community API; no SLA (UNVERIFIED explicitly) | N/A | Government site; no SLA; health machine handles stale | N/A |
| Removal plan | Fixture replay; OpenSky blocked by terms, so air falls back to fixture-only | — | Fixture fallback; api.trade.gov with api.data.gov key as alternate | Static context only |

---

## 5. Decisions (detailed in ADR-0012/0013/0014)

1. **Air**: admit adsb.lol (ODbL risk-accepted, ADR-0012). OpenSky rejected
   for live use (ADR-0012 records the terms barrier).
2. **Land**: admit CBP bwt.cbp.gov border wait times (keyless, ADR-0013).
3. **Rail**: defer FRA as a live layer (ADR-0014); Form 71 inventory permitted
   as future static context only.
4. **Data model**: facility-level signals (border wait times now; rail
   crossings if ever) enter as a new FacilityMetric record, NOT as synthetic
   TransportObservations (ADR-0015).

---

## 6. What this checkpoint does NOT include (per the design note)

No adapters, no config profiles, no UI, no agent surface, no fixtures built in
this phase. Next phase begins with the FacilityMetric model (ADR-0015) and
fixture-first adapters, exactly as the maritime build did.
