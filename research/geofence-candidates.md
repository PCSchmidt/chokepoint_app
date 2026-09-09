# Geofence Candidate Geometry (CANDIDATE — NOT APPROVED)

> **STATUS: CANDIDATE**
> **Review owner:** ChrisSchmidt (GitHub: PCSchmidt)
> **Approved: NO.** This file contains *candidate* geofence polygon geometry assembled
> from public sources for the three Chokepoint MVP regions (CHOKEPOINT-PLAN.md §2.1).
>
> **MUST NEVER be used for geofence-membership computation, entry/exit detection,
> or any metric computation until a human review commits it as `reviewed` geometry
> (CHOKEPOINT-PLAN.md §5.4 and ADR-0007).** `assertUsableGeofence()` in
> `src/config/chokepoints.ts` must continue to throw for placeholder geometry until
> that review lands.
>
> Candidate geometry is **never an official port boundary**. Even after review it
> remains a coarse demo geofence (8-20 vertices), not a navigation product. Per §4.3,
> every profile must keep the limitation "geofence does not equal official port
> boundary".

Coordinate reference: **WGS84 (EPSG:4326), [lat, lon] pairs, ordered rings**.
Vertices derived verbatim from an authoritative source are tagged `[CFR]`, `[SCA]`,
or `[OSM]`. Vertices interpolated, estimated, or eyeballed are tagged
`[APPROX]` — these are the weakest points and must be re-checked first during review.

---

## 1. long-beach-approach — outer-anchorage (waiting-cohort)

### 1.1 Candidate polygon

```
[
  [33.7182, -118.2052],
  [33.7181, -118.1768],
  [33.7181, -118.1331],
  [33.6731, -118.1008],
  [33.6382, -118.1167],
  [33.6700, -118.1900],
  [33.6950, -118.2250],
  [33.7072, -118.2387],
]
```

Vertex notes:
- `(33.7182, -118.2052)` [CFR] Anchorage G west corner, 33°43′05.4″N 118°12′18.7″W.
- `(33.7181, -118.1768)` [CFR] Anchorage F west corner, 33°43′05.1″N 118°10′36.5″W.
- `(33.7181, -118.1331)` [CFR] Anchorage F east corner, 33°43′05.1″N 118°07′59.0″W.
- `(33.6731, -118.1008)` [CFR] Anchorage F southeast corner, 33°40′23.0″N 118°06′03.0″W.
- `(33.6382, -118.1167)` [CFR] Anchorage F south corner, 33°38′17.5″N 118°07′00.0″W.
- `(33.6700, -118.1900)`, `(33.6950, -118.2250)` [APPROX] interpolated along the
  southern edge so the ring covers open water between F and G (the area just
  outside the Long Beach and Middle breakwaters where inbound vessels hold).
- `(33.7072, -118.2387)` [CFR] Anchorage G southwest corner, 33°42′25.9″N 118°14′19.2″W.

### 1.2 Sources

- **33 CFR §110.214 "Los Angeles and Long Beach harbors, California"**, paragraphs
  (b)(6) Commercial Anchorage F and (b)(7) Commercial Anchorage G (coordinates in
  NAD 83; ~1 m offset from WGS84, negligible at this coarse scale).
  https://www.ecfr.gov/current/title-33/section-110.214
- Background on anchor assignment outside the federal breakwater (VTIS assigns
  anchorages seaward of the breakwater): same section, paragraph (a)(1).

### 1.3 Rationale

The waiting cohort for LA/LB is the fleet holding outside the federal breakwater in
San Pedro Bay — locally the "fed anchor" fleet — which the CFR formalizes as
Commercial Anchorages F (outside the Long Beach breakwater) and G (outside the
Middle Breakwater), assigned by LA-Long Beach VTIS. §110.214 publishes exact corner
coordinates for both, so the candidate ring traces the union of F and G and fills
the gap between them with interpolated water-only vertices, staying south of the
breakwater. Vessels anchored inside the breakwater (Anchorages B–E) are handled by
ports/pilots and belong to a port-basin purpose, not this waiting-cohort fence.

### 1.4 Known limitations

- The ring merges F and G into one polygon; it includes water between them that is
  outside both designated anchorages, and the southern interpolated edge is not a
  regulatory line.
- CFR coordinates are NAD 83, not WGS84 (sub-metre to low-metre difference; immaterial
  for a coarse demo, but record the datum).
- The breakwater line itself is not digitized; the north edge follows anchorage
  corner latitudes, which sit just seaward of the breakwater.
- §110.214 lists other designated anchorages (including inside the breakwater and
  Explosives Anchorage); this fence intentionally excludes them.
- Does not capture anchoring activity south of ~33.63°N (deep-water holding farther
  offshore), which VTIS sometimes uses during congestion.

---

## 2. long-beach-approach — approach-corridor (approach-flow)

### 2.1 Candidate polygon

```
[
  [33.5917, -118.2333],
  [33.5917, -118.1917],
  [33.5917, -118.1500],
  [33.4625, -118.0942],
  [33.3333, -118.0383],
  [33.3250, -118.0758],
  [33.3167, -118.1125],
  [33.4542, -118.1729],
]
```

Vertex notes:
- `(33.5917, -118.2333)` [CFR] 33°35.5′N 118°14.0′W — southbound lane north end
  (§167.503(c)).
- `(33.5917, -118.1917)` [APPROX] interpolated north-edge midpoint.
- `(33.5917, -118.1500)` [CFR] 33°35.5′N 118°09.0′W — northbound lane north end
  (§167.503(b)); also on the §167.501 precautionary-area boundary.
- `(33.4625, -118.0942)` [APPROX] interpolated east-edge midpoint.
- `(33.3333, -118.0383)` [CFR] 33°20.0′N 118°02.3′W — northbound lane south end.
- `(33.3250, -118.0758)` [APPROX] interpolated, near the separation-zone south end
  (33°19.7′N 118°03.5′W / 33°19.0′N 118°05.6′W).
- `(33.3167, -118.1125)` [CFR] 33°19.0′N 118°06.75′W — southbound lane south end.
- `(33.4542, -118.1729)` [APPROX] interpolated west-edge midpoint.

### 2.2 Sources

- **33 CFR §167.500–§167.503** "In the approaches to Los Angeles-Long Beach Traffic
  Separation Scheme" (general, precautionary area, western approach, southern
  approach; NAD 83):
  https://www.ecfr.gov/current/title-33/section-167.500 ,
  https://www.ecfr.gov/current/title-33/section-167.503
- IMO-adopted TSS as implemented domestically by USCG (65 FR 53913, Sept. 6, 2000).

### 2.3 Rationale

The approach-flow fence should mirror the official Southern-approach TSS: a
separation zone with northbound and southbound traffic lanes converging on the
precautionary area at the bay entrance. §167.503 publishes the exact lane and
separation-zone endpoints, so the candidate ring is the convex hull of those CFR
points (both lane ends plus the separation-zone corners), subdivided with
interpolated midpoints to reach the 8-vertex minimum. The ring covers the separation
zone and both lanes; entry/exit counting across its edges approximates ships
entering/leaving the regulated approach.

### 2.4 Known limitations

- The ring is a hull over the TSS, so it includes the separation zone, both lanes,
  and their buffer water; it does not distinguish lane directionality (direction
  comes from vessel COG, not the fence).
- The §167.501 precautionary area (which overlaps the northern tip) is not
  separately modeled; its boundary intersects this fence at 33°35.5′N.
- The Western-approach TSS (§167.502, heading NW toward the coast) is excluded; only
  the southern approach is modeled.
- NAD 83 datum as above; interpolated vertices are not from any chart.
- If review wants strictly lane-only geometry, rebuild from the four CFR lane lines
  instead of the hull.

---

## 3. singapore-malacca-approach — strait-traffic-corridor (approach-flow)

### 3.1 Candidate polygon — ALL VERTICES [APPROX]

```
[
  [1.2600, 103.6100],
  [1.2500, 103.7500],
  [1.2650, 103.8500],
  [1.3000, 103.9500],
  [1.2700, 104.1500],
  [1.2400, 104.2800],
  [1.1300, 104.3000],
  [1.0900, 104.1800],
  [1.1300, 104.1000],
  [1.1500, 103.9600],
  [1.1100, 103.8400],
  [1.1700, 103.6200],
]
```

No vertex is chart-digitized. They are estimated from: (a) the MPA official
anchorage chartlet (which depicts the TSS lanes, port-limits line, and fairways),
(b) the published scale of the Singapore Strait (~113 km long, ~16-19 km wide,
Singapore north / Indonesian Riau islands south), and (c) the known location of the
IMO TSS lanes between Singapore and the Riau islands. Treat every coordinate as
±0.05° uncertain until a reviewer digitizes the IMO Ships' Routeing TSS limits.

### 3.2 Sources

- **MPA Singapore, "Port of Singapore — Anchorages, Fairways and Channels" chartlet**
  (official, WGS84, "for illustration only — must not be used for navigation"),
  shows the TSS traffic lanes, Singapore Port Limits line, and the TSS/fairway
  arrows through the strait:
  https://www.mpa.gov.sg/port-marine-ops/operations/port-infrastructure/anchorages
  (chartlet PDF: https://www.mpa.gov.sg/api/media/9f3f36b2-b8ee-4028-bc2c-1c3e0ca38a89/anchorages-chartlet.pdf)
- **IMO Ships' Routeing** — TSS "In the Strait of Malacca and Singapore" (the
  underlying regulatory definition; not digitized here — paywalled IMO text).
- **Wikipedia, "Singapore Strait"** (strait dimensions, Singapore north / Riau
  Islands south, deepwater passage to the Port of Singapore):
  https://en.wikipedia.org/wiki/Singapore_Strait
- **Wikipedia, "Strait of Malacca"** (corridor context, one of the busiest shipping
  lanes): https://en.wikipedia.org/wiki/Strait_of_Malacca

### 3.3 Rationale

The approach-flow corridor must follow the strait that carries Malacca traffic toward
Singapore: a diagonal band running WSW-ENE from the Malacca Strait proper (west of
~103.6°E, north of Karimun) along the TSS lanes between Singapore (north) and the
Riau islands of Batam and Bintan (south), exiting toward the South China Sea near
the eastern entrance (~104.3°E). The candidate ring's north edge stays just south of
the Singapore port-limits line (as depicted on the MPA chartlet); its south edge
stays north of the Batam/Bintan coasts; both ends extend into open water so entry
and exit events are captured.

### 3.4 Known limitations

- Weakest fence in this document: all 12 vertices are approximate, and the IMO TSS
  limits were not digitized from a regulatory source. A reviewer should re-derive
  this ring from the IMO Ships' Routeing TSS coordinates or MPA/UKHO chart digests.
- The band inevitably covers non-TSS water (including parts of the Batam north
  coast approach and areas outside Singapore port limits); it is a corridor proxy,
  not the TSS.
- The Malacca Strait proper (west of 103.4°E) is out of MVP scope; the fence only
  starts where the §2.1 region begins. This excludes upstream congestion (e.g., near
  Port Klang), so entry counts here measure arrivals into the Singapore approach,
  not Malacca-wide flow.
- Jurisdiction: the corridor crosses Indonesian, Malaysian, and Singaporean waters;
  no national boundary is encoded.

---

## 4. singapore-malacca-approach — singapore-roadstead (waiting-cohort)

### 4.1 Candidate polygon

```
[
  [1.2640, 103.8440],
  [1.2370, 103.8480],
  [1.2130, 103.8900],
  [1.2790, 104.1030],
  [1.3000, 104.1160],
  [1.3500, 104.0760],
  [1.3680, 104.0490],
  [1.3010, 103.8760],
  [1.2860, 103.8540],
]
```

Vertex notes: derived by taking the convex hull of the OpenStreetMap
`seamark:type=anchorage` polygons for the eastern anchorage cluster, then applying a
+0.02° buffer and simplification. All coordinates are [OSM]-derived (rounded to
0.001°); accuracy is limited by OSM tracing of the official MPA anchorages.

### 4.2 Sources

- **OpenStreetMap** `seamark:type=anchorage` polygons (OpenSeaMap-style tagging) for
  the eastern anchorages: Eastern Working (AEW), Eastern Bunkering A/B/C (AEBA,
  AEBB, AEBC), Eastern Petroleum A/B/C (AEPA, AEPB, AEPBC), Eastern Holding A/B/C
  (AEHA, AEHB, AEHC), Small Craft A/B (ASC/ASCA/ASCB), Laid-Up Vessels (ALUV),
  Eastern Special Purposes A (AESPA), Eastern Explosives Lighters (AEEL), Changi
  General Purposes (ACGP), Changi Barge Temporary Holding (ACBTH), Man-of-War
  (AMOW). Retrieved via Overpass API, 2026-02 (way IDs 182075788, 182075884,
  182075887, 182075914, 182075927, 182075957, 182075873, 182075880, 182075839,
  182076032, 182076046, 182076067, 182076070, 182076103, 182076112, 182076119,
  182076122, 182076129, 182076160, 182076172, 182076197, 182076205, 182076207,
  182076222, 182076226, 182076233, 182076239, 182076263, 182076280, 182076286,
  182076291, 182076300, 182075999, 182076025, 182076300).
  **© OpenStreetMap contributors — ODbL 1.0.** Any redistribution of OSM-derived
  geometry must carry ODbL attribution, and a derived database produced from it is
  subject to ODbL share-alike obligations (see CHOKEPOINT-PLAN.md §15). Flag this
  fence for a licensing review before production use.
- **MPA Singapore anchorage chartlet** (same URL as §3.2) — cross-check that the
  OSM polygons match the official anchorage layout (they do visually: the eastern
  cluster plus Changi-area holding anchorages).
- **eGazette (Singapore)** — MPA states the purpose of each anchorage is published
  at www.egazette.gov.sg (coordinates could be lifted from there for a future
  refinement; not fetched in this pass).

### 4.3 Rationale

The waiting cohort at Singapore is the eastern anchorage cluster: the working,
bunkering, petroleum, holding, laid-up, and OPL-type anchorages east of ~103.85°E,
between the Singapore south coast (north) and the TSS/port-limits line (south).
OSM maps these as individual named polygons matching MPA's official anchorage
codes, so a buffered hull over the cluster gives a defensible coarse waiting-cohort
fence that contains all at-anchor waiting vessels east of the port without
following every sector boundary.

### 4.4 Known limitations

- Geometry inherits OSM completeness/accuracy; ODbL attribution and share-alike
  obligations apply if this (or any derived product) is redistributed.
- The hull includes buffer water between anchorages and some water south of the
  port-limits line near the eastern edge; it is not the official port limit.
- The northern point (≈1.368°N, 104.049°E) is pulled up by the Changi Barge
  Temporary Holding anchorage near the Johor river mouth; verify it does not touch
  land/river on the review pass.
- Western anchorages (Western Working, Western Petroleum, Western Quarantine, off
  Jurong/Tuas ~103.6-103.8°E) are excluded; if the demo wants them counted, extend
  or add a second cluster.
- The fence overlaps the strait-traffic-corridor (§3) along the TSS; vessels
  anchored vs. underway must be separated by speed/AIS state, not by fence.

---

## 5. suez-canal-approaches — gulf-of-suez-approach (approach-flow, southern/Red Sea)

### 5.1 Candidate polygon — ALL VERTICES [APPROX]

```
[
  [29.9300, 32.5450],
  [29.9300, 32.5900],
  [29.8900, 32.6000],
  [29.7400, 32.6400],
  [29.5900, 32.6100],
  [29.5900, 32.4300],
  [29.6500, 32.3850],
  [29.7300, 32.4200],
  [29.8200, 32.4800],
  [29.8700, 32.5200],
]
```

Vertices are synthesized with margins around SCA-published features (marked where
they anchor the design):

- North limit ≈29.930°N: just north of the Suez entrance buoys (Hm. 80.5 pair at
  29°52.16-52.27′N, 32°32.96-33.16′E) and the West Waiting Area north limit
  29°52.12′N. [SCA anchor]
- East limit ≈32.60-32.64°E: covers the East Waiting Area buoys (to 32°35.29′E),
  the "V" berths (to 32°37′E) and the STS "A"/"B" areas (to 32°38′E). [SCA anchor]
- South limit ≈29.590°N: south of the STS "B" area (29°36′N) and of separation-zone
  buoy No. 1 (29°39.49′N 32°23.42′E). [SCA anchor]
- West edge ≈32.37-32.52°E: west of the separation zone (which extends 0.3 nm either
  side of the buoy line from 29°39.49′N 32°23.42′E to 29°48.55′N 32°32.12′E) and of
  the West Waiting Area (west limit 32°31.60′E). [SCA anchor]

### 5.2 Sources

- **Suez Canal Authority, "Rules of Navigation" (2020 edition), Art. 9 "Suez"**
  (pp. 14-18): separation-zone buoys (29°39.49′N 32°23.42′E; 29°48.55′N 32°32.12′E),
  "V" anchorage berths, East and West Waiting Area buoy limits, STS areas A/B,
  prohibited anchorage area, entrance buoys. Official flipbook (page text extracted
  from the site's search index):
  https://www.suezcanal.gov.eg/FlipPDFFiles/RulesOfNavigation/index.html
  (also rendered at https://www.suezcanal.gov.eg/English/Navigation/Pages/RulesOfNavigation.aspx)
- Egyptian Navy Hydrographic Dept. charts SC 01 / SC 02 are cited by SCA as the
  authoritative chart source; not available here — reviewer should verify against
  them if accessible.

### 5.3 Rationale

The southern (Red Sea) approach is where northbound convoys gather before transit:
SCA establishes a separation zone between two buoys, "V" berths for deep-draft
vessels, East and West Waiting Areas, and STS transfer areas A/B in the Gulf of
Suez. The candidate ring bounds that whole operating area — from just south of the
outermost STS/separation features (~29.59°N) to the canal entrance (~29.93°N) — so
entry into the fence ≈ arrival into the Suez waiting system. Boundaries were set
with a few-tenths-of-a-degree margin around the published buoy coordinates because
SCA publishes points, not area outlines.

### 5.4 Known limitations

- All vertices approximate; SCA gives buoy/berth points, not polygon outlines. A
  reviewer should regenerate edges from SC 01/SC 02 charts or the SCA drawings
  referenced in Rules of Navigation Part II.
- The ring is close to both Gulf shores; the east edge (~32.64°E near 29.74°N) and
  west edge (~32.37-32.42°E near 29.65-29.73°N) may overlap the intertidal zone or
  land in places. Verify against coastline data before any use.
- Excludes the Port of Suez inner basins and Adabiya; they are not needed for the
  approach-flow purpose.
- Security-zone / restricted-area overlays in the Gulf (if any are active) are not
  modeled.
- Occupancy of STS transfer zones can inflate "waiting" counts; this fence is
  approach-flow, so vessel state (anchored vs. underway) must come from AIS, not the
  fence.

---

## 6. suez-canal-approaches — port-said-approach (approach-flow, northern/Mediterranean)

### 6.1 Candidate polygon — ALL VERTICES [APPROX]

```
[
  [31.5000, 32.2900],
  [31.5000, 32.4800],
  [31.3500, 32.4800],
  [31.3400, 32.4000],
  [31.3300, 32.3400],
  [31.3300, 32.2700],
  [31.3500, 32.2600],
  [31.4000, 32.2600],
  [31.4300, 32.2800],
]
```

Vertices are synthesized with margins around SCA-published anchorage zones:

- North limit 31.500°N (31°30′N): north of Northern Area Zone 1 (north limit
  31°28.50′N) and Zone 3 (31°28.60′N). [SCA anchor]
- East limit ≈32.48°E: east of Zone 3 (east limit 32°28.30′E) and the
  trans-shipment areas (to 32°28′E). [SCA anchor]
- South limit ≈31.33°N (31°19.8′N): south of the Southern Area (C-berths, south
  limit 31°21.20′N) and near the fairway buoy (31°21.32′N 32°20.81′E) with margin,
  while staying north of the Port Said coast/breakwaters. [SCA anchor]
- West limit ≈32.26-32.27°E: west of Zone 2 "V" berths (west limit 32°16.00′E) and
  the Southern Area (west limit 32°16.95′E). [SCA anchor]

### 6.2 Sources

- **Suez Canal Authority, "Rules of Navigation" (2020 edition), Art. 8 "Port Said"**
  (pp. 7-13): fairway buoy position; Northern Area Zone 1 (draught >42-62 ft, lat
  31°27.00-28.50′N, W limit 32°18.00′E, E limit printed as "31°27.00′N" — apparent
  OCR/typesetting error, likely 32°27.00′E); Zone 2 "V" berths (lat 31°23.20-25.00′N,
  lon 32°16.00-20.00′E); Zone 3 (lat 31°27.10-28.60′N, lon 32°26.30-28.30′E);
  Southern Area "C" berths (lat 31°21.20-22.95′N, lon 32°16.95-20.40′E);
  trans-shipment areas; east/west approach channels and buoyage (Hm. 80-230).
  https://www.suezcanal.gov.eg/FlipPDFFiles/RulesOfNavigation/index.html

### 6.3 Rationale

The northern (Mediterranean) approach is the waiting and queuing system for
southbound convoys: SCA defines two main anchorage groups — the Northern Area
(zones 1-3 for deep-draft/VLCC-type vessels) and the Southern Area (C berths) —
plus trans-shipment anchorages, bounded by the east and west approach channels.
The candidate ring bounds the whole area from ~31°30′N (open sea north of the
zones) down to just north of the Port Said coast (~31°19.8′N), so entering the
fence ≈ arrival into the Port Said waiting system, and the ring stays clear of the
prohibited anchorage strip between the areas and the channels only by construction
of coarse edges (it is too coarse to exclude that strip exactly).

### 6.4 Known limitations

- All vertices approximate, synthesized as a bounding envelope around SCA zones;
  edges are not regulatory lines.
- One SCA east-limit coordinate for Zone 1 appears to contain a typo in the source
  text (latitude repeated where a longitude is expected); treated as 32°27.00′E.
  Reviewer must confirm against the Part II drawings or SC 01/SC 02.
- The ring includes the prohibited-anchorage corridor between the anchorage areas
  and the approach channels; a strict fence would need concave geometry.
- Excludes the inner harbor (Port Said harbor basins) and the canal itself.
- Excludes the 5-nm northbound continuation past Hm. 230 that SCA instructs
  departing vessels to use; entry events near the north edge are approximate.

---

## Cross-cutting limitations (applies to all six fences)

1. **CANDIDATE status** — nothing here is approved geometry. Membership computation
   remains blocked by `assertUsableGeofence()` until ADR-0007 review commits
   reviewed geometry versions (§5.4 requires: stable id, purpose, geometry version,
   CRS, inclusion rules, effective date, review owner, source/rationale).
2. **Not official boundaries** — these fences approximate operational areas
   (anchorages, TSS, waiting areas). They are not port limits, and must never be
   described as such in UI copy (§14.4; profile limitation strings already say
   this).
3. **Datum mixing** — CFR sources are NAD 83, SCA sources reference SC 01/SC 02
   (WGS84-family), MPA chartlet is WGS84, OSM is WGS84. At demo scale the NAD 83
   offset is negligible but must be recorded (§5.4 coordinate reference assumption).
4. **AIS coverage** — any count computed inside these fences inherits the AIS
   provider's regional coverage and blind spots (e.g., Class-B and fishing-vessel
   gaps); counts are "observed vessels in the defined geofence", never "all vessels
   at the port" (§7.1).
5. **Vertex count is intentionally coarse** (8-20 vertices); fine features
   (breakwaters, channels, sector boundaries) are deliberately not represented.

## Retrieval appendix (how sources were fetched, 2026-02)

- eCFR sections fetched via the official eCFR API
  (`https://www.ecfr.gov/api/versioner/v1/full/2025-10-02/title-33.xml?section=...`).
- MPA chartlet PDF fetched from the MPA media API link above; layout read from the
  chartlet image (labels + grid 103°40′/103°50′/104°00′E, 1°20′/1°10′N, WGS84).
- SCA Rules of Navigation text extracted from the official flipbook's
  `mobile/javascript/search_config.js` page-text index.
- OSM anchorage polygons fetched via Overpass API
  (`https://overpass-api.de/api/interpreter`), bbox 1.15,103.8 → 1.45,104.2,
  `way["seamark:type"="anchorage"]`; hull + 0.02° buffer computed with shapely.
