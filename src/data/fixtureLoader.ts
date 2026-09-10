/**
 * Fixture loader (CHOKEPOINT-PLAN.md §6.2 keyless-first, §12.2 fixture design).
 *
 * Fixtures are SYNTHETIC data with explicit SIMULATED provenance. The loader
 * refuses any fixture that is not clearly labeled as simulated: this is a hard
 * guard so simulated data can never masquerade as live observations (§3.1).
 *
 * Phase 0/1 constraint: fixtures are the ONLY data source. No provider
 * credentials are read anywhere in this module.
 */

import {
  normalizeObservation,
  type NormalizationResult,
  type RawObservation,
  type TransportObservation,
} from "./observation";

/** Every fixture manifest must declare exactly this truth state. */
export const REQUIRED_FIXTURE_TRUTH_STATE = "SIMULATED" as const;

export interface FixtureManifest {
  fixtureId: string;
  /** Must be exactly "SIMULATED" (§3.1). Anything else is rejected at load. */
  truthState: string;
  /** Redundant boolean guard; must be true. */
  simulated: true;
  description: string;
  provenance: {
    /** Where the data came from — always a synthetic generator, never a live feed. */
    generatedBy: string;
    providerId: string;
    licenseId: string;
  };
  scenario?: Record<string, unknown>;
  observations: RawObservation[];
}

export interface LoadedFixture {
  fixtureId: string;
  description: string;
  truthState: "SIMULATED";
  observations: TransportObservation[];
  rejected: Array<{ reason: string; observationId?: string | undefined }>;
}

export interface FixtureDirectoryResult {
  fixtures: LoadedFixture[];
  files: string[];
}

/** Validate a manifest's provenance labels before anything is normalized. */
export function assertSimulatedProvenance(manifest: unknown): asserts manifest is FixtureManifest {
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error("Fixture manifest must be a JSON object");
  }
  const m = manifest as Record<string, unknown>;
  if (m["truthState"] !== REQUIRED_FIXTURE_TRUTH_STATE) {
    throw new Error(
      `Fixture truthState must be exactly "${REQUIRED_FIXTURE_TRUTH_STATE}" (got: ${String(m["truthState"])}). ` +
        "Simulated data must never be labeled as OBSERVED."
    );
  }
  if (m["simulated"] !== true) {
    throw new Error('Fixture manifest must set "simulated": true');
  }
  const provenance = m["provenance"] as Record<string, unknown> | undefined;
  if (!provenance || typeof provenance !== "object") {
    throw new Error("Fixture manifest must include a provenance block");
  }
  const providerId = provenance["providerId"];
  if (typeof providerId !== "string" || !providerId.startsWith("simulated")) {
    throw new Error(
      `Fixture provenance.providerId must start with "simulated" (got: ${String(providerId)})`
    );
  }
  if (!Array.isArray(m["observations"])) {
    throw new Error("Fixture manifest must include an observations array");
  }
  if (typeof m["fixtureId"] !== "string" || m["fixtureId"].length === 0) {
    throw new Error("Fixture manifest must include a non-empty fixtureId");
  }
}

/**
 * Parse a fixture manifest into accepted canonical observations plus a list of
 * rejected records (invalid fixtures themselves are hard errors, not silence).
 */
export function parseFixture(raw: unknown): LoadedFixture {
  assertSimulatedProvenance(raw);
  const manifest = raw as FixtureManifest;

  const accepted: TransportObservation[] = [];
  const rejected: LoadedFixture["rejected"] = [];
  for (const record of manifest.observations) {
    const result: NormalizationResult = normalizeObservation(record);
    if (result.ok) {
      accepted.push(result.observation);
    } else {
      rejected.push({ reason: result.reason, observationId: result.observationId });
    }
  }

  return {
    fixtureId: manifest.fixtureId,
    description: manifest.description,
    truthState: "SIMULATED",
    observations: accepted,
    rejected,
  };
}
