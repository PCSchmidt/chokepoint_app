/**
 * Deterministic data tools (CHOKEPOINT-PLAN.md §4.4, §8.1, §8.2, §9.2
 * src/agent/tools.ts).
 *
 * The ONLY data path the agent may use (§8.1: the model is a language
 * interface over evidence, not the source of truth). Each tool:
 *  - reads a manager snapshot (never raw provider payloads),
 *  - returns a typed result with scope labels and provenance ids,
 *  - reports unavailable data honestly (absent is never zero, §3.3),
 *  - uses §7.1 scope semantics: "observed vessels in the defined geofence".
 *
 * Tools never mutate state: camera/replay intents are UI concerns returned as
 * typed requests for the caller to apply through app state (§8.6 ownership).
 */

import type { ChokepointSnapshot, DataManager } from "../data/manager";
import type { QueryIntent } from "./intent";

/** Provenance pointer: a claim cites one of these (§8.3, §3.2). */
export interface EvidencePointer {
  kind: "metric" | "observation" | "event" | "comparison";
  id: string;
}

export interface AgentClaim {
  id: string;
  text: string;
  category: "OBSERVATION" | "CALCULATION" | "COMPARISON" | "QUALITY" | "LIMITATION";
  support: EvidencePointer[];
  confidence: number;
  limitations?: string[];
}

export type ToolStatus = "ok" | "unavailable" | "refused";

export interface ToolResult {
  tool: string;
  status: ToolStatus;
  /** Status detail when refused/unavailable (honest, never fabricated). */
  note: string | null;
  chokepointId: string | null;
  window: { startAt: string; endAt: string } | null;
  claims: AgentClaim[];
  coverage: {
    sourceState: string | null;
    lastObservationAt: string | null;
    scopeLabel: string;
  } | null;
}

export const TOOLS_VERSION = "agent-tools-v1";

function snapshotClaims(snapshot: ChokepointSnapshot): AgentClaim[] {
  const claims: AgentClaim[] = [];
  const vc = snapshot.metrics.vesselCount;
  // §3.3/§7.1: an empty population with no observations is UNKNOWN, never
  // zero — "no activity" is banned when the source may be incomplete.
  const noData = vc.value === null || (vc.value === 0 && snapshot.observations.length === 0);
  claims.push({
    id: "claim-vessel-count",
    text:
      noData
        ? "Insufficient evidence to count vessels in the defined geofence — coverage here is unknown, not zero."
        : `${vc.value} classified freight vessels were observed in the defined geofence during the window.`,
    category: noData ? "LIMITATION" : "CALCULATION",
    support: [{ kind: "metric", id: vc.metricId }],
    confidence: noData ? 0 : vc.quality.state === "fresh" ? 0.95 : 0.7,
    limitations:
      noData
        ? ["Coverage for this location is unknown; absence of observations is not proof of absence."]
        : ["Coverage is limited to vessels visible to the source feed.", "Unclassified vessels are excluded from the count."],
  });
  const cmp = snapshot.comparisons.vesselCount;
  if (cmp.direction !== "unknown" && cmp.relativeChange !== null) {
    claims.push({
      id: "claim-vessel-count-baseline",
      text:
        cmp.direction === "stable" || Math.abs(cmp.relativeChange) < 1e-12
          ? "The observed vessel count was at the same level as the prior comparable window."
          : `The observed vessel count changed ${cmp.relativeChange > 0 ? "up" : "down"} ${Math.abs(cmp.relativeChange * 100).toFixed(1)}% versus the prior comparable window.`,
      category: "COMPARISON",
      support: [
        { kind: "comparison", id: `comparison:${vc.metricId}` },
        { kind: "metric", id: vc.metricId },
      ],
      confidence: cmp.qualityState === "fresh" ? 0.85 : 0.6,
      limitations: ["The baseline window is the prior comparable window, not an official statistic."],
    });
  }
  const mf = snapshot.metrics.movingFraction;
  if (mf.value !== null) {
    claims.push({
      id: "claim-moving-fraction",
      text: `The moving fraction of observed freight vessels was ${(mf.value * 100).toFixed(0)}% (derived from observed speeds; missing speeds excluded).`,
      category: "CALCULATION",
      support: [{ kind: "metric", id: mf.metricId }],
      confidence: mf.quality.state === "fresh" ? 0.9 : 0.6,
      limitations: ["Vessels with missing speed data are excluded from this fraction."],
    });
  }
  return claims;
}

/** map intent tool -> claim assembly. All data comes from the snapshot. */
export function runTool(
  intent: QueryIntent,
  manager: DataManager,
  window: { startAt: string; endAt: string },
): ToolResult {
  const chokepointId =
    intent.chokepointId ?? (manager.listChokepoints().length > 0 ? manager.listChokepoints()[0]!.id : null);
  if (!chokepointId) {
    return { tool: intent.tool, status: "refused", note: "no chokepoint in context", chokepointId: null, window: null, claims: [], coverage: null };
  }
  const known = manager.listChokepoints().some((c) => c.id === chokepointId);
  if (!known) {
    return {
      tool: intent.tool,
      status: "refused",
      note: "unknown chokepoint — the geographic scope is never expanded without confirmation (§8.2)",
      chokepointId,
      window: null,
      claims: [],
      coverage: null,
    };
  }
  const snapshot = manager.getSnapshot(chokepointId, window);
  const coverage = {
    sourceState: snapshot.health.fixture.state,
    lastObservationAt: snapshot.observations.length > 0 ? snapshot.observations[snapshot.observations.length - 1]!.observedAt : null,
    scopeLabel: "observed vessels in the defined geofence (SIMULATED fixtures)",
  };
  const claims = snapshotClaims(snapshot);
  const events = snapshot.events.map((e) => ({
    id: `event-${e.eventId}`,
    text: `${e.eventType}: ${e.metricId} ${e.relativeChange !== null ? `${e.relativeChange >= 0 ? "+" : ""}${(e.relativeChange * 100).toFixed(1)}%` : "unknown change"} vs baseline (threshold-crossing only)`,
    category: "COMPARISON" as const,
    support: [{ kind: "event" as const, id: e.eventId }],
    confidence: 0.8,
  }));
  switch (intent.tool) {
    case "count_vessels":
    case "summarize_chokepoint":
    case "show_vessel_cohort":
      return {
      tool: intent.tool,
      status: "ok",
      note: null,
      chokepointId,
      window,
      claims,
      coverage,
    };
    case "compare_with_baseline":
      return {
        tool: intent.tool,
        status: "ok",
        note: null,
        chokepointId,
        window,
        claims: claims.filter((c) => c.category === "COMPARISON" || c.category === "CALCULATION"),
        coverage,
      };
    case "list_recent_changes":
      return {
        tool: intent.tool,
        status: "ok",
        note: events.length === 0 ? "No events fired in this window (threshold rules; absence is not proof of absence)." : null,
        chokepointId,
        window,
        claims: events,
        coverage,
      };
    case "explain_metric": {
      const metricId = intent.metricId ?? "vessel_count";
      const formula = explainFormula(metricId, snapshot);
      return {
        tool: intent.tool,
        status: "ok",
        note: null,
        chokepointId,
        window: null,
        claims: [
          {
            id: `claim-explain-${metricId}`,
            text: formula,
            category: "LIMITATION",
            support: [{ kind: "metric", id: metricId }],
            confidence: 1,
          },
        ],
        coverage: null,
      };
    }
    default:
      return {
        tool: intent.tool,
        status: "refused",
        note: "tool not implemented in fixture mode (§4.4 allowlist v1)",
        chokepointId,
        window,
        claims: [],
        coverage,
      };
  }
}

/** Documented formula descriptions (§4.5: plain language, no causal text). */
const FORMULA_DOCS: Readonly<Record<string, string>> = {
  vessel_count: "Count of unique classified freight entities with at least one accepted observation inside the reviewed geofence during the window. Unclassified entities are reported separately, never counted as freight.",
  moving_fraction: "Fraction of observed freight vessels with a reported speed above the moving threshold. Vessels with missing speed data are excluded, never counted as stopped (missing is not zero).",
  entry_count: "Boundary crossings into the reviewed geofence from consecutive observations. Gaps beyond the maximum gap are excluded and reported as uncertain.",
  exit_count: "Boundary crossings out of the reviewed geofence from consecutive observations. Gaps beyond the maximum gap are excluded, never silently counted.",
  dwell_cohort_size: "Number of freight vessels whose observations fall inside the waiting-cohort fence with the min-observation and max-gap constraints.",
  dwell_median_seconds: "Median duration of the longest continuous visit per vessel in the cohort. Conservative split: gaps do not extend a visit.",
};

function explainFormula(metricId: string, snapshot: ChokepointSnapshot): string {
  const metrics: Record<string, { formulaVersion: string; value: number | null; unit: string }> = {
    vessel_count: { formulaVersion: snapshot.metrics.vesselCount.formulaVersion, value: snapshot.metrics.vesselCount.value, unit: snapshot.metrics.vesselCount.unit },
    moving_fraction: { formulaVersion: snapshot.metrics.movingFraction.formulaVersion, value: snapshot.metrics.movingFraction.value, unit: snapshot.metrics.movingFraction.unit },
    entry_count: { formulaVersion: snapshot.metrics.entryCount.formulaVersion, value: snapshot.metrics.entryCount.value, unit: snapshot.metrics.entryCount.unit },
    exit_count: { formulaVersion: snapshot.metrics.exitCount.formulaVersion, value: snapshot.metrics.exitCount.value, unit: snapshot.metrics.exitCount.unit },
    dwell_cohort_size: { formulaVersion: snapshot.metrics.dwellCohortSize.formulaVersion, value: snapshot.metrics.dwellCohortSize.value, unit: snapshot.metrics.dwellCohortSize.unit },
    dwell_median_seconds: { formulaVersion: snapshot.metrics.dwellMedianSeconds.formulaVersion, value: snapshot.metrics.dwellMedianSeconds.value, unit: snapshot.metrics.dwellMedianSeconds.unit },
  };
  const m = metrics[metricId] ?? null;
  if (!m) return `Metric ${metricId} is not part of the supported set.`;
  const doc = FORMULA_DOCS[metricId] ?? "Documented formula (see the evidence drawer).";
  return `${metricId} (${m.formulaVersion}): ${doc} Current value: ${m.value === null ? "UNKNOWN (insufficient evidence)" : `${m.value} ${m.unit}`}.`;
}
