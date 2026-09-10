/**
 * Agent module boundary (CHOKEPOINT-PLAN.md §8, §9.2 src/agent).
 *
 * Phase 4 verified agent: typed intents (§4.4), deterministic data tools,
 * evidence bundle builder (§5.6), claim evaluator (§8.3–8.5), and the
 * deterministic answer generator. Voice (voiceSession) is a later phase
 * (Decision 2: evidence before voice).
 */

export * from "./intent";
export * from "./tools";
export * from "./evidenceBundle";
export * from "./evaluator";
export * from "./generator";
export * from "./pipeline";
export * from "./voiceSession";
