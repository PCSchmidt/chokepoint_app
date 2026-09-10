/**
 * Agent pipeline (CHOKEPOINT-PLAN.md §8, §9.2 src/agent): question ->
 * typed intent -> deterministic tool -> evidence bundle -> evaluator ->
 * caveated answer. Fixture-mode v1: no LLM anywhere in the loop, the wall
 * clock is never read, and every number traces to a metric (§8.1).
 */

import type { DataManager } from "../data/manager";
import { buildEvidenceBundle, type EvidenceBundle } from "./evidenceBundle";
import { evaluateToolResult, type EvaluatorVerdict } from "./evaluator";
import { answerQuestion, type AgentAnswer } from "./generator";
import type { AgentClaim } from "./tools";

export interface AgentContext {
  /** The chokepoint currently under investigation (null = launcher). */
  chokepointId: string | null;
  /** The active replay/window (null = launcher). */
  window: { startAt: string; endAt: string } | null;
}

/**
 * Metric value map for the evaluator, from the snapshot the tool ran
 * against. The evaluator and the generator see the SAME numbers (§8.3
 * numeric accuracy).
 */
export function metricValueMap(bundle: EvidenceBundle, snapshotMetrics: Record<string, number | null>): Map<string, number | null> {
  void bundle;
  return new Map(Object.entries(snapshotMetrics));
}

/**
 * Full agent turn. Returns the evidence bundle, verdict, and answer. The
 * wall clock is never read: windows come from app state (§12.5).
 */
export async function askAgent(
  question: string,
  manager: DataManager,
  context: AgentContext,
): Promise<{ bundle: EvidenceBundle; verdict: EvaluatorVerdict | null; answer: AgentAnswer }> {
  const bundle = buildEvidenceBundle(question, manager, {
    chokepointId: context.chokepointId,
    window: context.window ?? manager.defaultWindow(),
  });
  if (!bundle.tool) {
    return { bundle, verdict: null, answer: answerQuestion(bundle, {
      verdict: "rejected",
      acceptedClaims: [],
      rejectedClaims: [],
      requiredCaveats: [bundle.abstention ?? "Insufficient evidence to answer."],
      evaluatorVersion: "claim-evaluator-v1",
    }) };
  }
  // Snapshot metric values: the claims reference these ids. explain_metric
  // has no window (it documents a formula), so fall back to context data.
  const toolWindow = bundle.tool.window ?? context.window ?? manager.defaultWindow();
  const snapshot = manager.getSnapshot(bundle.intent!.chokepointId!, toolWindow);
  const metricValues = metricValueMap(bundle, {
    vessel_count: snapshot.metrics.vesselCount.value,
    moving_fraction: snapshot.metrics.movingFraction.value,
    dwell_cohort_size: snapshot.metrics.dwellCohortSize.value,
    dwell_median_seconds: snapshot.metrics.dwellMedianSeconds.value,
    entry_count: snapshot.metrics.entryCount.value,
    exit_count: snapshot.metrics.exitCount.value,
  });
  const verdict = evaluateToolResult(bundle.tool, metricValues, bundle.sourceHealth);
  const answer = answerQuestion(bundle, verdict);
  return { bundle, verdict, answer };
}

export type { AgentClaim };
