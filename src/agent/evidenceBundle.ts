/**
 * Evidence bundle builder (CHOKEPOINT-PLAN.md §5.6, §8.2, §9.2 src/agent).
 *
 * The evidence bundle is the CONTRACT between deterministic analytics and
 * generative explanation: it carries the question, the windowed observations
 * (as references, never unbounded raw data), derived metrics, detected
 * events, source health, and the allowed/rejected claim lists after
 * evaluation. A draft answer may be built ONLY from the accepted portion.
 *
 * Deterministic: same question + same data timeline -> identical bundle
 * (except bundleId, which derives from content, not the wall clock).
 */

import type { DataManager } from "../data/manager";
import { parseQuestion, resolveWindow, type QueryIntent, type ParsedQuestion } from "./intent";
import { runTool, TOOLS_VERSION, type ToolResult } from "./tools";

export const EVIDENCE_BUNDLE_SCHEMA = "evidence-bundle-v1";

export interface EvidenceBundleQuestion {
  rawText: string;
  normalizedIntent: string;
  scope: string;
}

export interface EvidenceBundle {
  bundleId: string;
  question: EvidenceBundleQuestion;
  intent: QueryIntent | null;
  /** Why no bundle was produced (honest abstention, §3.3). */
  abstention: string | null;
  tool: ToolResult | null;
  observationCount: number;
  observationIds: string[];
  sourceHealth: string | null;
  versions: {
    schema: string;
    tools: string;
  };
}

/** Deterministic 32-bit FNV-1a -> hex id (bundleId from content, no clock). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildEvidenceBundle(
  rawText: string,
  manager: DataManager,
  context: { chokepointId: string | null; window: { startAt: string; endAt: string } },
): EvidenceBundle {
  const parsed: ParsedQuestion = parseQuestion(rawText, manager.listChokepoints());
  if (!parsed.intent) {
    return {
      bundleId: `bundle-${fnv1a(rawText)}`,
      question: { rawText, normalizedIntent: "unknown", scope: "none" },
      intent: null,
      abstention: parsed.abstention,
      tool: null,
      observationCount: 0,
      observationIds: [],
      sourceHealth: null,
      versions: { schema: EVIDENCE_BUNDLE_SCHEMA, tools: TOOLS_VERSION },
    };
  }
  const intent = parsed.intent;
  const chokepointId = intent.chokepointId ?? context.chokepointId;
  const window =
    intent.window && context.window
      ? resolveWindow(intent.window, context.window.endAt, manager.defaultWindow())
      : context.window;
  if (!chokepointId || !window) {
    return {
      bundleId: `bundle-${fnv1a(rawText)}`,
      question: { rawText, normalizedIntent: intent.tool, scope: "none" },
      intent,
      abstention: "no chokepoint or window in context — the scope is never guessed (§8.2)",
      tool: null,
      observationCount: 0,
      observationIds: [],
      sourceHealth: null,
      versions: { schema: EVIDENCE_BUNDLE_SCHEMA, tools: TOOLS_VERSION },
    };
  }
  const effectiveIntent: QueryIntent = { ...intent, chokepointId };
  const tool = runTool(effectiveIntent, manager, window);
  const snapshot = manager.getSnapshot(chokepointId, window);
  return {
    bundleId: `bundle-${fnv1a(`${rawText}|${chokepointId}|${window.startAt}|${window.endAt}`)}`,
    question: {
      rawText,
      normalizedIntent: `${intent.tool}@${chokepointId}`,
      scope: `${chokepointId}:${window.startAt}/${window.endAt}`,
    },
    intent: effectiveIntent,
    abstention: tool.status === "ok" ? null : (tool.note ?? "tool did not succeed"),
    tool,
    observationCount: snapshot.observations.length,
    observationIds: snapshot.observations.map((o) => o.observationId),
    sourceHealth: snapshot.health.fixture.state,
    versions: { schema: EVIDENCE_BUNDLE_SCHEMA, tools: TOOLS_VERSION },
  };
}
