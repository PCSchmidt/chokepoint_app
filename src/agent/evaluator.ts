/**
 * Claim evaluator (CHOKEPOINT-PLAN.md §8.3, §8.4, §8.5, §9.2 src/agent).
 *
 * claim-evaluator-v1: deterministic checks over the tool claims. Every
 * generated answer MUST pass through here (§8.2: the generator may not
 * bypass the evaluator). Output follows §8.5: verdict, accepted claim ids,
 * rejected claims with reasons, required caveats, and an evaluator version
 * identifier.
 *
 * Checks (§8.3):
 *  - banned causal/predictive/threat/identity/intent language
 *  - every claim must carry provenance support
 *  - "all vessels at the port" scope overreach is rejected (§7.1)
 *  - every number must match a referenced metric value
 *  - freshness/coverage caveats are added when material
 */

import type { AgentClaim } from "./tools";
import type { ToolResult } from "./tools";

export const EVALUATOR_VERSION = "claim-evaluator-v1";

export type RejectedCategory = "INTENT" | "THREAT" | "CAUSE" | "IDENTITY" | "PREDICTION";

export interface RejectedClaim {
  claimId: string;
  claim: string;
  reason: string;
}

export interface EvaluatorVerdict {
  verdict: "accepted" | "accepted_with_caveats" | "rejected";
  acceptedClaims: string[];
  rejectedClaims: RejectedClaim[];
  requiredCaveats: string[];
  evaluatorVersion: string;
}

/** Banned-language table (§8.4 restricted categories, §14.4). */
const BANNED: ReadonlyArray<{ category: RejectedCategory; pattern: RegExp; reason: string }> = [
  {
    category: "THREAT",
    pattern: /\b(suspicious|threat|hostile|illegal|smuggl(ing|er))\b/i,
    reason: "Threat or suspicion language is never generated (§8.4 THREAT).",
  },
  {
    category: "CAUSE",
    pattern: /\b(because|caused by|cause of|due to|resulting from|disruption)\b/i,
    reason: "Causal language without independent evidence is rejected (§8.4 CAUSE).",
  },
  {
    category: "PREDICTION",
    pattern: /\b(will (rise|fall|increase|decrease|grow)|forecast|predict(ed|ive|ion)?)\b/i,
    reason: "Predictions require a validated predictive model (§8.4 PREDICTION).",
  },
  {
    category: "IDENTITY",
    pattern: /\b(beneficial owner|owner is|operator is|flagged by)\b/i,
    reason: "Entity identity beyond provider-published metadata is rejected (§8.4 IDENTITY).",
  },
  {
    category: "INTENT",
    pattern: /\b(intends? to|planning to|evade)\b/i,
    reason: "Intent claims are always rejected (§8.4 INTENT).",
  },
];

/** Scope overreach: counts must never be presented as port-wide totals. */
const SCOPE_OVERREACH = /\ball vessels (at|in|near) (the )?(port|harbor|harbour|area)\b/i;

/**
 * Numeric match: every number in the claim text must correspond to a metric
 * value (directly, as a percent rendering, or via a support pointer).
 * LIMITATION/QUALITY claims carry documented constants, not measurements.
 */
function numberSupported(claim: AgentClaim, metricValues: ReadonlyMap<string, number | null>, n: string): boolean {
  const numeric = Number(n);
  if (claim.category === "LIMITATION" || claim.category === "QUALITY") return true;
  if (claim.support.some((s) => s.id.includes(n))) return true;
  for (const v of metricValues.values()) {
    if (v === null) continue;
    if (Math.abs(v - numeric) < 1e-9) return true;
    if (Math.abs(v * 100 - numeric) < 0.15) return true; // 0.91 -> 91%
  }
  return false;
}

export function evaluateClaim(claim: AgentClaim, metricValues: ReadonlyMap<string, number | null>): RejectedClaim | null {
  for (const rule of BANNED) {
    if (rule.pattern.test(claim.text)) {
      return { claimId: claim.id, claim: claim.text, reason: rule.reason };
    }
  }
  if (SCOPE_OVERREACH.test(claim.text)) {
    return {
      claimId: claim.id,
      claim: claim.text,
      reason:
        'Scope overreach: counts must use "observed vessels in the defined geofence" semantics, never port-wide totals (§7.1, §8.3).',
    };
  }
  if (claim.support.length === 0) {
    return {
      claimId: claim.id,
      claim: claim.text,
      reason: "No provenance reference — every claim must cite evidence (§8.3).",
    };
  }
  // Numeric accuracy applies to MEASUREMENT numbers. Numbers inside
  // timestamps (ISO stamps, verbatim provider lane-update labels like
  // "At 8:00 am MDT") are provenance strings, not claims — strip them before
  // the check (§8.3 numeric accuracy; ADR-0013 facility claims).
  const withoutTimestamps = claim.text
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const numbers = withoutTimestamps.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const n of numbers) {
    if (!numberSupported(claim, metricValues, n)) {
      return {
        claimId: claim.id,
        claim: claim.text,
        reason: `Number ${n} does not match any metric in the evidence bundle (§8.3 numeric accuracy).`,
      };
    }
  }
  return null;
}

/** Required caveats (§8.3): freshness/coverage/derived labeling. */
function requiredCaveats(claims: readonly AgentClaim[], sourceHealth: string | null): string[] {
  const caveats: string[] = [];
  if (sourceHealth && sourceHealth !== "fresh") {
    caveats.push(`Source state is ${sourceHealth}; coverage may be incomplete.`);
  }
  if (claims.some((c) => c.category === "COMPARISON")) {
    caveats.push("The baseline is the prior comparable window, not an official statistic.");
  }
  if (claims.some((c) => c.category === "CALCULATION")) {
    caveats.push(
      "Counts and fractions are derived from observations in the defined geofence only; vessels outside source coverage are not included.",
    );
  }
  if (claims.length === 0) {
    caveats.push("Insufficient evidence to answer.");
  }
  return caveats;
}

/** Evaluate the tool claims of a bundle (§5.6 claimsAllowed/claimsRejected). */
export function evaluateClaims(
  claims: readonly AgentClaim[],
  context: { metricValues: ReadonlyMap<string, number | null>; sourceHealth: string | null },
): EvaluatorVerdict {
  const rejectedClaims: RejectedClaim[] = [];
  const accepted: string[] = [];
  for (const claim of claims) {
    const rejection = evaluateClaim(claim, context.metricValues);
    if (rejection) rejectedClaims.push(rejection);
    else accepted.push(claim.id);
  }
  const caveats = requiredCaveats(claims, context.sourceHealth);
  const verdict: EvaluatorVerdict["verdict"] =
    accepted.length === 0
      ? "rejected"
      : rejectedClaims.length > 0 || caveats.length > 0
        ? "accepted_with_caveats"
        : "accepted";
  return {
    verdict,
    acceptedClaims: accepted,
    rejectedClaims,
    requiredCaveats: caveats,
    evaluatorVersion: EVALUATOR_VERSION,
  };
}

/** Evaluate a tool result directly (metric map supplied by the caller). */
export function evaluateToolResult(tool: ToolResult, metricValues: ReadonlyMap<string, number | null>, sourceHealth: string | null): EvaluatorVerdict {
  return evaluateClaims(tool.claims, { metricValues, sourceHealth });
}
