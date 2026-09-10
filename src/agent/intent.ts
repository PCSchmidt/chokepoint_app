/**
 * Typed query intents (CHOKEPOINT-PLAN.md §4.4, §8.2, §9.2 src/agent).
 *
 * The v1 intent parser is DETERMINISTIC: a closed vocabulary of patterns over
 * the §4.4 tool allowlist. It converts a user question into a typed intent or
 * honestly abstains (UNKNOWN intent) — it never infers scope, threat, or
 * causation (§8.2). An LLM can later replace this front end WITHOUT changing
 * the tool/evaluator contract: intents are the stable interface.
 *
 * The wall clock is never read: relative windows resolve against a caller-
 * supplied reference time (deterministic, testable).
 */

import type { ChokepointProfile } from "../config/chokepoints";

/** §4.4 tool allowlist. */
export type ToolName =
  | "summarize_chokepoint"
  | "count_vessels"
  | "compare_with_baseline"
  | "list_recent_changes"
  | "show_vessel_cohort"
  | "focus_chokepoint"
  | "set_time_window"
  | "start_replay"
  | "stop_replay"
  | "explain_metric";

export type RelativeWindow = "last_6_hours" | "last_24_hours" | "last_3_days";

export interface QueryIntent {
  tool: ToolName;
  /** Chokepoint id when the question names one (null = current context). */
  chokepointId: string | null;
  window: RelativeWindow | null;
  /** Metric id for compare/explain intents. */
  metricId: string | null;
}

export interface ParsedQuestion {
  intent: QueryIntent | null;
  /** Why parsing abstained (honest empty state, §3.3). */
  abstention: string | null;
  rawText: string;
}

/** The v1 parser knows metric ids by their snapshot keys. */
export const KNOWN_METRIC_IDS = [
  "vessel_count",
  "moving_fraction",
  "dwell_cohort_size",
  "dwell_median_seconds",
  "entry_count",
  "exit_count",
] as const;

/** Deterministic phrase table: tool -> trigger patterns (lowercase). */
const TOOL_PATTERNS: ReadonlyArray<{ tool: ToolName; patterns: RegExp[] }> = [
  { tool: "start_replay", patterns: [/\b(start|play|resume|run) (the )?(replay|playback)\b/i] },
  { tool: "stop_replay", patterns: [/\b(stop|pause|halt) (the )?(replay|playback)\b/i] },
  { tool: "set_time_window", patterns: [/\b(set|change|narrow|widen) (the )?(time )?window\b/i, /\b(show|display) (me )?the last (6|24|72) ?h(ours)?\b/i] },
  { tool: "compare_with_baseline", patterns: [/\bcompared? (to|with|against)\b/i, /\bvs\.? (the )?baseline\b/i, /\bchange (from|vs) baseline\b/i] },
  { tool: "count_vessels", patterns: [/\bhow many (vessels|ships|boats)\b/i, /\bvessel count\b/i] },
  { tool: "list_recent_changes", patterns: [/\bwhat (has )?changed\b/i, /\brecent (changes|events)\b/i, /\bany events\b/i] },
  { tool: "summarize_chokepoint", patterns: [/\bsummar(y|ize|ise)\b/i, /\boverview\b/i, /\bwhat.s (the )?situation\b/i] },
  { tool: "show_vessel_cohort", patterns: [/\b(show|list|which) (me )?(the )?(vessels|ships|cohort)\b/i, /\bwaiting cohort\b/i, /\banchored vessels\b/i] },
  { tool: "explain_metric", patterns: [/\bhow is .*calculated\b/i, /\bwhat does .*mean\b/i, /\bexplain\b/i] },
  { tool: "focus_chokepoint", patterns: [/\b(focus|goto|go to|take me to|show me|open|view)\b/i] },
];

function matchTool(text: string): ToolName | null {
  for (const { tool, patterns } of TOOL_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return tool;
  }
  return null;
}

function matchChokepoint(text: string, profiles: readonly ChokepointProfile[]): string | null {
  const t = text.toLowerCase();
  for (const p of profiles) {
    if (t.includes(p.id.toLowerCase())) return p.id;
    // Any significant name word matches: "Long Beach", "Singapore", "Suez".
    // Short words (<4 chars) never match — they are stop words, not places.
    const words = p.name.toLowerCase().split(/[ /]+/).filter((w) => w.length >= 4);
    if (words.some((w) => t.includes(w))) return p.id;
  }
  return null;
}

function matchWindow(text: string): RelativeWindow | null {
  const t = text.toLowerCase();
  if (/\b24 ?h|24 hours|last day\b/.test(t)) return "last_24_hours";
  if (/\b3 days|72 ?h\b/.test(t)) return "last_3_days";
  if (/\b6 ?h|6 hours\b/.test(t)) return "last_6_hours";
  return null;
}

function matchMetric(text: string): string | null {
  const t = text.toLowerCase();
  for (const m of KNOWN_METRIC_IDS) {
    if (t.includes(m.replace(/_/g, " "))) return m;
  }
  if (/\bmoving\b/.test(t)) return "moving_fraction";
  if (/\bdwell\b/.test(t)) return "dwell_median_seconds";
  if (/\bentr(y|ies)\b/.test(t)) return "entry_count";
  if (/\bexit(s|ing)?\b/.test(t)) return "exit_count";
  return null;
}

/**
 * Parse a question into a typed intent. Deterministic: same text + profiles
 * -> same intent. Unmatched questions abstain with a reason — the caller
 * must not guess (§8.2: do not infer intent without evidence).
 */
export function parseQuestion(
  rawText: string,
  profiles: readonly ChokepointProfile[],
): ParsedQuestion {
  const text = rawText.trim();
  if (text.length === 0) {
    return { intent: null, abstention: "empty question", rawText };
  }
  const tool = matchTool(text);
  if (!tool) {
    return {
      intent: null,
      abstention: "no supported intent matched — try: vessel count, summary, baseline comparison, recent changes, or explain a metric",
      rawText,
    };
  }
  const chokepointId = matchChokepoint(text, profiles);
  // Actions that need a target chokepoint abstain when none is named and the
  // question does not say "current/here" — geographic scope is never expanded
  // or guessed (§8.2).
  const contextWords = /\b(current|this|here)\b/.test(text.toLowerCase());
  const needsTarget =
    tool !== "explain_metric" && tool !== "set_time_window" && tool !== "start_replay" && tool !== "stop_replay";
  if (needsTarget && !chokepointId && !contextWords) {
    return {
      intent: null,
      abstention: "no chokepoint named — name one (Long Beach, Singapore, Suez) or ask about the current view",
      rawText,
    };
  }
  const intent: QueryIntent = {
    tool,
    chokepointId,
    window: matchWindow(text),
    metricId: tool === "explain_metric" || tool === "compare_with_baseline" ? matchMetric(text) : matchMetric(text),
  };
  if (tool === "compare_with_baseline" && !intent.metricId) {
    // Default comparison metric is the headline count (documented default).
    intent.metricId = "vessel_count";
  }
  return { intent, abstention: null, rawText };
}

/**
 * Resolve a relative window against a reference time and a maximum available
 * window (the fixture/live timeline bounds). The result is clamped to what
 * data exists — never silently widened, never read from the wall clock.
 */
export function resolveWindow(
  relative: RelativeWindow,
  referenceAt: string,
  available: { startAt: string; endAt: string },
): { startAt: string; endAt: string } {
  const hours = relative === "last_24_hours" ? 24 : relative === "last_3_days" ? 72 : 6;
  const endMs = Math.min(Date.parse(referenceAt), Date.parse(available.endAt));
  const startMs = Math.max(Date.parse(available.startAt), endMs - hours * 3_600_000);
  const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
  return { startAt: iso(startMs), endAt: iso(endMs) };
}
