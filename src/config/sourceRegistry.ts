/**
 * Source registry (CHOKEPOINT-PLAN.md §4.3, §6, §6.1).
 *
 * Data-driven record of candidate sources and their admission-gate status.
 * No source is admitted: every terms decision is TBD (see DATA_SOURCES.md).
 * A source may only move to "admitted" after every §6.1 checklist item is
 * documented in DATA_SOURCES.md. Fixture data is not a provider source; it is
 * labeled SIMULATED and handled by the fixture loader (src/data/fixtureLoader.ts).
 */

export type SourceAdmissionStatus =
  | "candidate" // under consideration; terms decision pending
  | "admitted"  // §6.1 gate fully documented; eligible for production config
  | "rejected"  // terms or risk ruled it out
  | "deferred"; // real for a later phase; not evaluated yet

export interface SourceRegistryRecord {
  sourceId: string;
  label: string;
  /** Capability slot from the §6 source table. */
  capability:
    | "live-vessel-positions"
    | "vessel-classification"
    | "port-context"
    | "air-cargo-positions"
    | "border-wait-times"
    | "traffic-flow"
    | "port-throughput";
  admissionStatus: SourceAdmissionStatus;
  /** §6.1 gate: null until the terms decision is made. */
  termsDecision: "TBD" | "approved" | "rejected";
  candidateProvider: string;
  keyRisk: string;
  keylessUsable: boolean;
}

export const SOURCE_REGISTRY: readonly SourceRegistryRecord[] = [
  {
    // Admitted 2026-09-09 as a documented risk acceptance (ADR-0010): no
    // published data-use terms; accepted for the non-commercial portfolio demo
    // with in-memory-only retention, no raw redistribution, and server-side key.
    sourceId: "aisstream",
    label: "AISStream (first admitted live AIS provider, risk-accepted)",
    capability: "live-vessel-positions",
    admissionStatus: "admitted",
    termsDecision: "approved",
    candidateProvider: "AISStream",
    keyRisk: "No published data-use terms (verified absence); no history; live-only",
    keylessUsable: false,
  },
  {
    // Same provider and the same ADR-0010 decision; classification fields come
    // from ShipStaticData messages.
    sourceId: "ais-classification",
    label: "AISStream ShipStaticData fields (vessel classification)",
    capability: "vessel-classification",
    admissionStatus: "admitted",
    termsDecision: "approved",
    candidateProvider: "AISStream",
    keyRisk: "Missing or incorrect classifications",
    keylessUsable: false,
  },
  {
    sourceId: "osm-context",
    label: "OpenStreetMap / public geospatial sources",
    capability: "port-context",
    admissionStatus: "candidate",
    termsDecision: "TBD",
    candidateProvider: "OpenStreetMap",
    keyRisk: "ODbL attribution and derived-database obligations",
    keylessUsable: true,
  },
  {
    // Admitted 2026-09-10 as a documented risk acceptance (ADR-0012): free
    // API, ODbL v1.0 for the API and all public data (share-alike honored via
    // the ADR-0010 posture: bounded in-memory buffer, no raw redistribution).
    // OpenSky was evaluated and REJECTED for live use: its terms require a
    // written agreement for ANY operational REST API integration, even
    // non-profit (VERIFIED 2026-09-10) — see ADR-0012.
    // Operator classification is inferred from provider-published metadata
    // and documented callsign heuristics only (§8.4 IDENTITY) — never
    // asserted as broadcast fact.
    sourceId: "adsb-lol",
    label: "adsb.lol (first admitted live air-cargo source, risk-accepted; OpenSky rejected for live use)",
    capability: "air-cargo-positions",
    admissionStatus: "admitted",
    termsDecision: "approved",
    candidateProvider: "adsb.lol",
    keyRisk: "No published rate limits (UNVERIFIED); operator classification inferred, not broadcast; ODbL share-alike on published derivatives",
    keylessUsable: true,
  },
  {
    // Admitted 2026-09-10 (ADR-0013): CBP's own bwt.cbp.gov endpoint verified
    // live with all 85 US crossings, keyless, US-gov public-domain basis.
    // Wait-time values are OBSERVED facility metrics (ADR-0015), never mixed
    // into vessel/entity totals. api.trade.gov + free api.data.gov key is the
    // documented fallback service.
    sourceId: "cbp-wait-times",
    label: "CBP Border Wait Times via bwt.cbp.gov (keyless, OBSERVED facility metrics)",
    capability: "border-wait-times",
    admissionStatus: "admitted",
    termsDecision: "approved",
    candidateProvider: "CBP",
    keyRisk: "Update cadence is per-port and periodic (hours-stale at quiet crossings is normal); US-border scope only",
    keylessUsable: true,
  },
  {
    sourceId: "tomtom-flow",
    label: "Optional TomTom or permitted public source",
    capability: "traffic-flow",
    admissionStatus: "deferred",
    termsDecision: "TBD",
    candidateProvider: "TomTom",
    keyRisk: "Proprietary terms and request costs",
    keylessUsable: false,
  },
  {
    sourceId: "port-throughput",
    label: "Official port/open-data sources",
    capability: "port-throughput",
    admissionStatus: "deferred",
    termsDecision: "TBD",
    candidateProvider: "various official open-data portals",
    keyRisk: "Different definitions and reporting cadence",
    keylessUsable: true,
  },
];

/** No live source is admitted in Phase 0/1; the app runs fixture-only (§6.2). */
export function admittedSources(): SourceRegistryRecord[] {
  return SOURCE_REGISTRY.filter((s) => s.admissionStatus === "admitted");
}
