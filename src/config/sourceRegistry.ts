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
    sourceId: "aisstream",
    label: "AISStream (or alternative permitted AIS provider)",
    capability: "live-vessel-positions",
    admissionStatus: "candidate",
    termsDecision: "TBD",
    candidateProvider: "AISStream",
    keyRisk: "API terms, coverage, historical retention",
    keylessUsable: false,
  },
  {
    sourceId: "ais-classification",
    label: "AIS message fields plus source metadata",
    capability: "vessel-classification",
    admissionStatus: "candidate",
    termsDecision: "TBD",
    candidateProvider: "AIS provider (same as positions)",
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
    sourceId: "adsb-lol",
    label: "adsb.lol or another permitted feed",
    capability: "air-cargo-positions",
    admissionStatus: "deferred",
    termsDecision: "TBD",
    candidateProvider: "adsb.lol",
    keyRisk: "Coverage, terms, operator classification",
    keylessUsable: true,
  },
  {
    sourceId: "cbp-wait-times",
    label: "CBP or relevant government source",
    capability: "border-wait-times",
    admissionStatus: "deferred",
    termsDecision: "TBD",
    candidateProvider: "CBP",
    keyRisk: "Geographic scope and update reliability",
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
