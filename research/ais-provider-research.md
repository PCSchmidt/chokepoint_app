# AIS Provider Research — First Live AIS Source for Chokepoint (Portfolio Demo)

Date: 2026-09-09
Scope: verify AISStream.io's CURRENT terms against the `gods-eye-view` inspiration claim ("Free, beta, no formal ToS; AIS is a public broadcast"), and evaluate alternatives against the §6.1 admission-gate checklist (`CHOKEPOINT-PLAN.md` §6.1, `DATA_SOURCES.md` §2).
Method: direct fetches of provider pages (aisstream.io home/documentation/privacy; aishub.net; ais.fm; datalastic.com home/pricing/terms; Kpler/MarineTraffic data-services page; dma.dk AIS pages; NOAA MarineCadastre AIS handler). No Serper web-search key was configured, so claims below come from primary pages only; third-party reviews were not consulted.
Status legend: **VERIFIED** = read directly from the provider's own page on 2026-09-09. **UNVERIFIED** = not stated by the provider or could not be reached; do not guess.

---

## 1. AISStream.io — current state (primary answer)

The site has been substantially redesigned since the inspiration repo was written, and now has real developer documentation (`aisstream.io/documentation`) with a "Limits and operational considerations" section. The core legal finding is unchanged:

- **There is still no terms-of-service page.** Site links are Home, Documentation, Account, GitHub, Privacy. `terms-of-service`, `/terms`, `/docs` all 404. The only legal page is `/privacypolicy`, and it covers **personal data only** (IP, browser info, GitHub identity). It says nothing about the AIS data itself.
- Therefore the data-use rules — storage, caching, redistribution, attribution — are **UNVERIFIED because they do not exist in writing**. The inspiration repo's "no formal ToS" remains accurate as of 2026-09-09. Note: the repo's *rationale* ("AIS is a public broadcast") is the repo author's argument, **not** a provider grant of rights.
- Pricing: the homepage states the WebSocket API runs "in real-time **and for free**" (VERIFIED). No pricing page or paid tier exists.

### Documented technical facts (VERIFIED, aisstream.io/documentation)

- Endpoint: `wss://stream.aisstream.io/v0/stream` (binary WebSocket frames, UTF-8 JSON payload, permessage-deflate supported). GitHub sign-in, API key required, key must live server-side.
- **Direct browser connections are explicitly NOT permitted** — "Connect from your own server and proxy only the information each client needs." This matches Chokepoint's Phase 2 server-side API design.
- Subscription model: bounding boxes **required**; `FiltersShipMMSI` (max 200 MMSIs) and `FilterMessageTypes` optional; re-sending a subscription replaces the active config.
- Limits: 3 subscribed connections per account; 3 open connections per originating IP; valid subscription required within 3 s of connect; subscription updates max 1/s; MMSI filter list max 200.
- Failure behavior (documented, refreshingly honest): **no SLA or uptime guarantee**; events are **not durably replayed**; slow consumers get messages dropped; reconnect with exponential backoff + jitter; from **September 2026**, uncompressed connections get per-user bandwidth limits with message drops.
- Message types: 25, including `PositionReport`, `StandardClassBPositionReport`, `ExtendedClassBPositionReport`, `ShipStaticData` (static + voyage data incl. ship **type code** — the vessel-classification field Chokepoint needs), `StaticDataReport`, `AidsToNavigationReport`, `StandardSearchAndRescueAircraftReport`.
- Historical data: **none**. Live stream only, explicitly not replayable. Baseline windows must come from another source.
- Coverage: global community-receiver network claimed; **known blind spots are not documented (UNVERIFIED)** and can only be measured empirically per chokepoint.

---

## 2. Terms matrix — §6.1 admission-gate checklist

| Checklist item | AISStream.io | AISHub.net | ais.fm | Datalastic | MarineTraffic (Kpler) | NOAA MarineCadastre (US gov) | Danish DMA (dma.dk) |
|---|---|---|---|---|---|---|---|
| Terms & commercial status | No data-use ToS exists (VERIFIED absence). Personal-data privacy policy only. Free (VERIFIED). | Free for members who **share their own live AIS feed back** to the network (VERIFIED on homepage). Formal membership terms page currently 404s — UNVERIFIED. | **Domain lapsed** — ais.fm now serves a personal blog (aisajib.com). Service appears defunct. | Paid, self-service credit-based subscription (Stripe checkout, 14-day money-back trial) — VERIFIED. Entry price UNVERIFIED (prices render client-side). | Paid commercial data services (API, live NMEA stream, archive since 2010), quote-based/enterprise sales — VERIFIED cost class only. | Free historical downloads; US federal dataset. Reuse statement not found on data page — license basis UNVERIFIED (US-gov work, conventionally public domain). | "Historical AIS data … free for down-load" (VERIFIED). Detailed reuse license UNVERIFIED — the AIS-data-management-policy page 404'd during this session. |
| Raw storage allowed? | UNVERIFIED — nothing written. Risk: unwritten. | UNVERIFIED beyond membership rules. | N/A (defunct). | Yes for display/store/copy/internal use, **as long as the product does not expose or redistribute raw data** (VERIFIED in terms). | UNVERIFIED (behind sales contract). | Effectively yes (bulk CSV downloads are the product) — subject to license basis above. | Effectively yes (bulk CSV zip downloads) — subject to license basis above. |
| Normalized/derived storage allowed? | UNVERIFIED — nothing written. | UNVERIFIED. | N/A. | **Constrained**: no derivative databases, no resell/sublicense/publish/redistribute, no third-party data exposure (VERIFIED). Demo-side internal derived aggregates likely fine; anything published needs human review. | UNVERIFIED (typical commercial products permit derived display; UNVERIFIED here). | Yes (bulk download implies derived use) — confirm license basis. | Yes (bulk download implies derived use) — confirm license basis. |
| Required attribution | None stated — courtesy attribution recommended (UNVERIFIED as any obligation). | None stated — UNVERIFIED. | N/A. | None stated in fetched terms excerpt — UNVERIFIED. | UNVERIFIED. | Attribution expected by convention (NOAA/MarineCadastre) — UNVERIFIED as a formal requirement. | Attribution expected by convention — UNVERIFIED as a formal requirement. |
| Rate limits / quotas | VERIFIED: 3 conns/account, 3 conns/IP, 1 subscription update/s, 200 MMSI filters, 3 s subscribe window, must consume continuously or messages are dropped; Sept 2026 uncompressed bandwidth caps. | VERIFIED: **max 1 request/minute** on the webservice (returns nothing if faster); JSON/XML/CSV, geo + MMSI/IMO + age filters. | N/A. | Credit-based per-call model (1 credit basic position, 3 credits Pro, ~5 credits historical queries) — VERIFIED mechanics; monthly credit volumes per tier UNVERIFIED. | UNVERIFIED (contract-based). | N/A (bulk file downloads). | N/A (bulk file downloads). |
| Acceptable caching duration | UNVERIFIED — nothing written. Suggest session-scoped/short-TTL buffer and nothing committed to the repo. | UNVERIFIED. | N/A. | Storage permitted internally; duration unspecified — UNVERIFIED. | UNVERIFIED. | Indefinite (bulk historical snapshots). | Indefinite (bulk historical snapshots). |
| Coverage & blind spots | Global community-receiver claim; blind spots undocumented — UNVERIFIED; measure per chokepoint. | Community receiver network (~1,700 stations claimed, 83 countries); coverage map on site. | N/A. | Claims 750,000+ ship database, global; UNVERIFIED quality per chokepoint. | Strong commercial coverage incl. archive since 2010 — cost is the barrier. | US coastal waters only (daily CSVs, ~116.7 GB/yr). No Panama/Suez. | Danish waters only (Danish straits / Baltic approaches). |
| Failure behavior | VERIFIED, explicit: no SLA, no replay, drops when slow, reconnect guidance with backoff/jitter. Maps cleanly onto Chokepoint's health-state machine (`DEGRADED`/`UNAVAILABLE`). | Simple HTTP-style polling; behavior on outage UNVERIFIED. | N/A. | Terms mention possible downtime; no SLA details found — UNVERIFIED. | Contract-based — UNVERIFIED. | Files appear daily; gaps possible — UNVERIFIED cadence guarantee. | "Continuously updated" — cadence guarantee UNVERIFIED. |
| Removal plan if terms change | Straightforward: adapter interface (Phase 1) + fixture mode already planned. No contractual entanglement since no terms exist. Replacement candidates: DMA/NOAA historical replay, or paid provider. | Drop membership; no feed sent back. | N/A (gone). | Cancel subscription (terms: cancellation stops renewal; annual non-refundable after 30 days — VERIFIED clause). | End contract. | Stop using files; trivial. | Stop using files; trivial. |

---

## 3. Recommendation

**Yes — AISStream.io is suitable as the first admitted live AIS provider for the portfolio demo**, with documented conditions. It is the only free, live, software-only option found, its operational limits are now formally documented, and its no-SLA/no-replay failure model fits Chokepoint's existing health-state and honest-empty-state design. Conditions:

1. **Record the terms decision honestly in `DATA_SOURCES.md`:** "no data-use terms published (verified 2026-09-09); use treated as acceptable-risk for a non-commercial demo." The §6.1 "terms" item can only be satisfied by documenting the *absence* of terms — flag it, do not paper over it.
2. **Minimize raw-data retention:** stream to an in-memory/short-TTL buffer (suggest ≤ 24–72 h, nothing committed to the repo). Publish only derived aggregates. Never redistribute raw AIS messages.
3. **Courtesy attribution:** visible "Live AIS via AISStream.io" in the attribution control, plus a note that coverage is community-receiver-based and incomplete.
4. **Proxy through the backend** — direct browser connections are banned by the provider and the key must stay server-side. This already matches the Phase 2 design.
5. **Use NOAA MarineCadastre and/or Danish DMA historical CSVs for baseline windows and deterministic demo replay** (AISStream has no history). If demo chokepoints are chosen in US or Danish waters, this gives free, permissibly-usable history; Panama/Suez chokepoints would have live-only coverage.
6. **Keep the provider swappable** (planned Phase 1 source-adapter interface) and write the removal plan: fixture/historical replay fallback, paid provider as last resort.

**Rejected/unfit alternatives:** AISHub (requires operating a physical AIS receiver and sharing your raw feed back — not feasible for a software-only demo); ais.fm (domain lapsed, service defunct); Datalastic and MarineTraffic/Kpler (paid; quote/credit-based — note as future commercial-grade upgrade path, not demo path).

---

## 4. Red flags

- **"No formal ToS" is a real, standing risk** — unchanged from the inspiration repo's note. AISStream grants no written rights, imposes no written limits on storage/redistribution, and could add terms, throttle, or shut down at any time (it has a beta-track history). Mitigation: minimal retention, provider abstraction, removal plan.
- **No SLA and no replay** — data loss is expected, not exceptional. The health-state machine must treat stream gaps as normal operation, and metrics must carry freshness caveats.
- **September 2026 uncompressed-bandwidth limits** — a near-term behavioral change that can silently drop messages; enable permessage-deflate from day one.
- **ais.fm's domain lapse** is a concrete example of a free AIS source vanishing; it validates the plan's provider-abstraction requirement.
- **Datalastic's "no derivative databases" clause** directly conflicts with Chokepoint's normalized/derived storage model if it were ever adopted — flag before any paid integration.
- **AISHub reciprocity** (share your own feed) is a hard dependency on hardware, not just a terms nuance.

## 5. Undecided — for the human

1. Accept AISStream despite the absent data-use terms, or wait/choose differently? (This is a risk-acceptance decision, not a research finding.)
2. Raw-cache retention window (proposed: ≤ 72 h, session-scoped, never committed).
3. Create the AISStream account (GitHub sign-in) and empirically measure coverage/blind spots at the candidate chokepoints — the only way to close the coverage item.
4. Choose demo chokepoints: US/Danish waters enable free NOAA/DMA historical baselines; Panama/Suez would be live-only.
5. Verify NOAA's formal license statement and DMA's AIS-data-management policy (page 404'd this session) before committing any downloaded CSV — even though bulk files should stay out of the repo regardless.
6. Confirm attribution wording for each admitted source in the visible attribution control (§15).
