/**
 * Observation cohort filtering and classification rules
 * (CHOKEPOINT-PLAN.md §3.3, §2.1, §17 Phase 2 "vessel cohort filtering").
 *
 * Rules implemented here (§3.3):
 *  - A vessel without a reliable classification is excluded from type-specific
 *    totals and counted separately as UNCLASSIFIED.
 *  - When a provider reclassifies an entity over time, the most recent
 *    accepted observation determines the classification.
 *  - Classification is "reliable" only when quality.classification is
 *    "confirmed"; "inferred" and "unknown" classifications are unreliable.
 */

import type { EntityType, TransportObservation } from "../data/observation";
import { sortObservations } from "../data/observation";

/** Freight classification allowlist for the maritime MVP (§2.1). */
export const FREIGHT_ENTITY_TYPES: readonly EntityType[] = [
  "cargo_vessel",
  "tanker",
  "bulk_carrier",
];

export type ClassificationReliability = "confirmed" | "inferred" | "unknown";

export interface EntityClassification {
  entityId: string;
  entityType: EntityType;
  /** True only when the winning observation's classification is "confirmed". */
  reliable: boolean;
  /** The observation that determined the classification (most recent accepted). */
  decidedBy: string;
  /** Times the provider classification changed across the window (diagnostic). */
  classificationChanges: number;
}

/**
 * Classification per entity: the most recent accepted observation wins.
 * Deterministic tie-break on observationId when two observations share an
 * observedAt timestamp.
 */
export function entityClassifications(
  observations: readonly TransportObservation[],
): Map<string, EntityClassification> {
  const result = new Map<string, EntityClassification>();
  for (const o of sortObservations(observations)) {
    const existing = result.get(o.entityId);
    if (existing === undefined) {
      result.set(o.entityId, {
        entityId: o.entityId,
        entityType: o.entityType,
        reliable: o.quality.classification === "confirmed",
        decidedBy: o.observationId,
        classificationChanges: 0,
      });
    } else {
      if (existing.entityType !== o.entityType) existing.classificationChanges += 1;
      existing.entityType = o.entityType;
      existing.reliable = o.quality.classification === "confirmed";
      existing.decidedBy = o.observationId;
    }
  }
  return result;
}

export type CohortBucket = "freight" | "unclassified" | "other";

export interface Cohort {
  /** Entities counted toward type-specific freight totals (§3.3). */
  freight: string[];
  /** Entities without a reliable classification; never counted as freight. */
  unclassified: string[];
  /** Visible context outside the freight allowlist (e.g. aircraft, unknown). */
  other: string[];
  /** Entity-level classification details for the evidence record (§4.5). */
  details: EntityClassification[];
}

/**
 * Split observed entities into freight / unclassified / other cohorts.
 * Unreliable classifications (inferred/unknown) land in "unclassified" even
 * when entityType looks freight-like — §3.3 counts them separately, never in
 * type-specific totals.
 */
export function cohortByClassification(
  observations: readonly TransportObservation[],
  allowlist: readonly EntityType[] = FREIGHT_ENTITY_TYPES,
): Cohort {
  const cohort: Cohort = { freight: [], unclassified: [], other: [], details: [] };
  for (const c of entityClassifications(observations).values()) {
    cohort.details.push(c);
    if (!c.reliable) {
      cohort.unclassified.push(c.entityId);
    } else if (allowlist.includes(c.entityType)) {
      cohort.freight.push(c.entityId);
    } else {
      cohort.other.push(c.entityId);
    }
  }
  cohort.freight.sort();
  cohort.unclassified.sort();
  cohort.other.sort();
  cohort.details.sort((a, b) => a.entityId.localeCompare(b.entityId));
  return cohort;
}
