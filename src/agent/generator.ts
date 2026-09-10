/**
 * Generator (CHOKEPOINT-PLAN.md §8.2, §9.2 src/agent/generator.ts).
 *
 * Drafts a plain-language answer from the ACCEPTED portion of an evaluated
 * evidence bundle — never from raw provider text, never from rejected
 * claims. In fixture mode the generator is deterministic template assembly;
 * an LLM may later draft the wording, but the contract below (accepted
 * bundle in, caveated answer out, evaluator-gated) does not change.
 *
 * Responsible language (§14.4): "Observed", "derived", "the available data
 * suggests" — never "confirmed disruption", "suspicious", or causation.
 */

import type { EvidenceBundle } from "./evidenceBundle";
import type { EvaluatorVerdict } from "./evaluator";
import type { AgentClaim } from "./tools";

export const GENERATOR_VERSION = "answer-generator-v1";

export interface AgentAnswer {
  /** Plain-language answer text (accepted claims only, in tool order). */
  text: string;
  caveats: string[];
  rejected: Array<{ claim: string; reason: string }>;
  /** Evidence identifiers a UI can render for inspection (§4.5). */
  evidenceRefs: string[];
  generatorVersion: string;
  evaluatorVersion: string;
  verdict: EvaluatorVerdict["verdict"];
}

/** Responsible-language rendering of a claim (no causal additions, §14.4). */
function renderClaim(claim: AgentClaim): string {
  return claim.text;
}

/**
 * Draft an answer from a bundle + its evaluator verdict. Only accepted
 * claims appear; rejected claims are surfaced as transparency, never text.
 * Abstentions are honest (§3.3): an empty accepted set yields "insufficient
 * evidence", not a guess.
 */
export function draftAnswer(bundle: EvidenceBundle, verdict: EvaluatorVerdict): AgentAnswer {
  if (bundle.abstention || !bundle.tool) {
    return {
      text: bundle.abstention ?? "Insufficient evidence to answer.",
      caveats: ["Insufficient evidence to answer."],
      rejected: [],
      evidenceRefs: [],
      generatorVersion: GENERATOR_VERSION,
      evaluatorVersion: verdict.evaluatorVersion,
      verdict: "rejected",
    };
  }
  const acceptedById = new Map(bundle.tool.claims.filter((c) => verdict.acceptedClaims.includes(c.id)).map((c) => [c.id, c]));
  const parts: string[] = [];
  for (const id of verdict.acceptedClaims) {
    const claim = acceptedById.get(id);
    if (claim) parts.push(renderClaim(claim));
  }
  if (bundle.tool.note) parts.push(bundle.tool.note);
  const text = parts.length > 0 ? parts.join(" ") : "Insufficient evidence to answer.";
  const evidenceRefs = bundle.tool.claims
    .filter((c) => verdict.acceptedClaims.includes(c.id))
    .flatMap((c) => c.support.map((s) => `${s.kind}:${s.id}`));
  return {
    text,
    caveats: verdict.requiredCaveats,
    rejected: verdict.rejectedClaims.map((r) => ({ claim: r.claim, reason: r.reason })),
    evidenceRefs,
    generatorVersion: GENERATOR_VERSION,
    evaluatorVersion: verdict.evaluatorVersion,
    verdict: verdict.verdict,
  };
}

/**
 * Draft an answer directly from an already-computed verdict. The pipeline
 * computes the verdict with the evaluator; the generator cannot bypass it
 * because it only accepts a verdict object (§8.2).
 */
export function answerQuestion(bundle: EvidenceBundle, verdict: EvaluatorVerdict): AgentAnswer {
  return draftAnswer(bundle, verdict);
}
