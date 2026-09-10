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
import type { AgentClaim, UiAction } from "./tools";
import { MetricsRegistry } from "../telemetry/metrics";

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
): Promise<{ bundle: EvidenceBundle; verdict: EvaluatorVerdict | null; answer: AgentAnswer; uiAction: UiAction | null }> {
  return askAgentWithContext(question, manager, context, null);
}

/**
 * Variant with an explicit context chokepoint override (the UI passes the
 * chokepoint currently under investigation even when the question does not
 * name one).
 */
export async function askAgentWithContext(
  question: string,
  manager: DataManager,
  context: AgentContext,
  contextChokepointId: string | null,
  metrics?: MetricsRegistry | undefined,
): Promise<{ bundle: EvidenceBundle; verdict: EvaluatorVerdict | null; answer: AgentAnswer; uiAction: UiAction | null }> {
  const effectiveContext = contextChokepointId
    ? { ...context, chokepointId: context.chokepointId ?? contextChokepointId }
    : context;
  const bundle = buildEvidenceBundle(question, manager, {
    chokepointId: effectiveContext.chokepointId,
    window: effectiveContext.window ?? manager.defaultWindow(),
  });
  if (!bundle.tool) {
    metrics?.inc("chokepoint_agent_requests_total", { outcome: "abstained" });
    metrics?.inc("chokepoint_evidence_bundles_total", { result: "abstained" });
    return { bundle, verdict: null, answer: answerQuestion(bundle, {
      verdict: "rejected",
      acceptedClaims: [],
      rejectedClaims: [],
      requiredCaveats: [bundle.abstention ?? "Insufficient evidence to answer."],
      evaluatorVersion: "claim-evaluator-v1",
    }), uiAction: null };
  }
  // UI-action tools carry no analytical claims: nothing for the evaluator to
  // gate (§8.6 — transactional acceptance, applied by the caller). The
  // response text is the tool's acceptance note, never a claim the visual
  // state already changed.
  if (bundle.tool.uiAction) {
    metrics?.inc("chokepoint_agent_requests_total", { outcome: "ui_action" });
    metrics?.inc("chokepoint_evidence_bundles_total", { result: "ok" });
    return {
      bundle,
      verdict: null,
      answer: answerQuestion(bundle, {
        verdict: "accepted",
        acceptedClaims: [],
        rejectedClaims: [],
        requiredCaveats: [],
        evaluatorVersion: "claim-evaluator-v1",
      }),
      uiAction: bundle.tool.uiAction,
    };
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
  metrics?.inc("chokepoint_evidence_bundles_total", { result: "ok" });
  metrics?.inc("chokepoint_claims_accepted_total", {}, verdict.acceptedClaims.length);
  for (const r of verdict.rejectedClaims) {
    metrics?.inc("chokepoint_claims_rejected_total", { category: rejectionCategory(r.reason) });
  }
  metrics?.inc("chokepoint_agent_requests_total", {
    outcome: verdict.verdict === "rejected" ? "rejected" : "answered",
  });
  return { bundle, verdict, answer, uiAction: null };
}

/** Map an evaluator rejection reason to a bounded §13.1 label. */
function rejectionCategory(reason: string): string {
  if (/THREAT/.test(reason)) return "THREAT";
  if (/Causal|CAUSE/.test(reason)) return "CAUSE";
  if (/PREDICTION/.test(reason)) return "PREDICTION";
  if (/IDENTITY/.test(reason)) return "IDENTITY";
  if (/INTENT/.test(reason)) return "INTENT";
  if (/provenance/i.test(reason)) return "PROVENANCE";
  if (/Scope overreach/.test(reason)) return "SCOPE";
  return "NUMERIC";
}

export type { AgentClaim };
