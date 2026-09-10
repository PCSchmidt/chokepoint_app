/**
 * Watchlist (CHOKEPOINT-PLAN.md Workflow E, §9.2 src/app, §11.1 local-first).
 *
 * A user saves a chokepoint with a metric, a threshold, and a freshness
 * policy. The local-first version evaluates the watchlist DETERMINISTICALLY
 * against the replay/fixture dataset — no scheduled jobs, no external
 * notifications (those belong to a later hosted phase, §11.3).
 *
 * Evaluation language is threshold-crossing only (§2.2, §14.4): "vessel_count
 * +12.5% vs baseline (threshold 10%)" — never causal or threat language.
 * Unknown comparisons NEVER fire (§3.3, §8.4): an UNKNOWN baseline stays
 * unknown instead of becoming a confident trigger.
 */

import type { ChokepointSnapshot } from "../data/manager";

/** Snapshot metric ids that a watch can observe. */
export type WatchMetricId =
  | "vessel_count"
  | "moving_fraction"
  | "dwell_cohort_size"
  | "dwell_median_seconds"
  | "entry_count"
  | "exit_count";

export const WATCH_METRIC_LABELS: Readonly<Record<WatchMetricId, string>> = {
  vessel_count: "Observed vessels in the defined geofence",
  moving_fraction: "Moving fraction",
  dwell_cohort_size: "Dwell cohort size",
  dwell_median_seconds: "Median dwell (seconds)",
  entry_count: "Entry count",
  exit_count: "Exit count",
};

export type WatchDirection = "increase" | "decrease";

/**
 * Freshness policy (Workflow E): a watch may require a fresh source state or
 * accept stale/degraded data. "require-fresh" turns stale comparisons into
 * UNKNOWN, never into a trigger.
 */
export type WatchFreshnessPolicy = "require-fresh" | "allow-stale";

export interface WatchlistEntry {
  id: string;
  chokepointId: string;
  /** Snapshot of the profile geofences at save time (Workflow E: "records the geofence"). */
  fenceIds: string[];
  metricId: WatchMetricId;
  direction: WatchDirection;
  /** Relative change threshold in percent (e.g. 10 = fires at +10% or more). */
  relativePctThreshold: number;
  freshnessPolicy: WatchFreshnessPolicy;
  createdAt: string;
  configVersion: string;
}

export type WatchEvaluationStatus =
  | "fired"
  | "clear"
  | "unknown"
  | "unavailable";

export interface WatchEvaluation {
  entryId: string;
  status: WatchEvaluationStatus;
  /** Threshold-crossing language only; no causal text (§14.4). */
  note: string;
  observedValue: number | null;
  baselineValue: number | null;
  relativeChangePct: number | null;
}

/** Deterministic entry id: same watch saved twice updates in place. */
export function watchEntryId(entry: Omit<WatchlistEntry, "id" | "createdAt">): string {
  return [
    entry.chokepointId,
    entry.metricId,
    entry.direction,
    entry.relativePctThreshold,
    entry.freshnessPolicy,
  ].join("|");
}

/** Validate a parsed JSON value as a WatchlistEntry (local storage is untrusted input). */
function isWatchlistEntry(value: unknown): value is WatchlistEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.chokepointId === "string" &&
    typeof e.metricId === "string" &&
    (e.metricId in WATCH_METRIC_LABELS) &&
    (e.direction === "increase" || e.direction === "decrease") &&
    typeof e.relativePctThreshold === "number" &&
    Number.isFinite(e.relativePctThreshold) &&
    e.relativePctThreshold > 0 &&
    (e.freshnessPolicy === "require-fresh" || e.freshnessPolicy === "allow-stale") &&
    Array.isArray(e.fenceIds) &&
    e.fenceIds.every((f) => typeof f === "string") &&
    typeof e.createdAt === "string" &&
    !Number.isNaN(Date.parse(e.createdAt)) &&
    typeof e.configVersion === "string"
  );
}

const WATCHLIST_STORAGE_KEY = "chokepoint.watchlist.v1";

/** Load entries from a storage. Corrupt entries are skipped, never crash. */
export function loadWatchlist(storage: Pick<Storage, "getItem">): WatchlistEntry[] {
  const raw = storage.getItem(WATCHLIST_STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isWatchlistEntry);
}

/** Persist entries to a storage (§11.1 local-first; nothing leaves the device). */
export function saveWatchlist(entries: readonly WatchlistEntry[], storage: Pick<Storage, "setItem">): void {
  storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(entries));
}

/** Upsert: same id replaces the existing entry (latest config wins). */
export function upsertWatchEntry(
  entries: readonly WatchlistEntry[],
  entry: WatchlistEntry,
): WatchlistEntry[] {
  const rest = entries.filter((e) => e.id !== entry.id);
  return [...rest, entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function removeWatchEntry(entries: readonly WatchlistEntry[], id: string): WatchlistEntry[] {
  return entries.filter((e) => e.id !== id);
}

const METRIC_VIEWS: Readonly<Record<WatchMetricId, (s: ChokepointSnapshot) => {
  value: number | null; comparison: { relativeChange: number | null; direction: string; qualityState: string } | null;
}>> = {
  vessel_count: (s) => ({ value: s.metrics.vesselCount.value, comparison: s.comparisons.vesselCount }),
  moving_fraction: (s) => ({ value: s.metrics.movingFraction.value, comparison: s.comparisons.movingFraction }),
  dwell_cohort_size: (s) => ({ value: s.metrics.dwellCohortSize.value, comparison: null }),
  dwell_median_seconds: (s) => ({ value: s.metrics.dwellMedianSeconds.value, comparison: null }),
  entry_count: (s) => ({ value: s.metrics.entryCount.value, comparison: null }),
  exit_count: (s) => ({ value: s.metrics.exitCount.value, comparison: null }),
};

/**
 * Evaluate one entry against a snapshot (deterministic; no wall clock).
 *
 * Fired only when the measured relative change meets BOTH the direction and
 * the threshold magnitude. Unknown comparisons, null metrics, or a failed
 * freshness policy yield "unknown"/"unavailable" — never a confident trigger
 * (§3.3). The note is threshold-crossing language only (§14.4).
 */
export function evaluateWatchEntry(entry: WatchlistEntry, snapshot: ChokepointSnapshot): WatchEvaluation {
  const view = METRIC_VIEWS[entry.metricId](snapshot);
  const base = {
    entryId: entry.id,
    observedValue: view.value,
    baselineValue: null as number | null,
    relativeChangePct: null as number | null,
  };

  // No baseline comparison exists for this metric in the current snapshot:
  // without a comparison a threshold cannot be evaluated honestly.
  if (!view.comparison) {
    return {
      ...base,
      status: view.value === null ? "unavailable" : "unknown",
      note:
        view.value === null
          ? `${entry.metricId}: no data for the window — not evaluated (unknown, not zero)`
          : `${entry.metricId}: no baseline comparison available — not evaluated`,
    };
  }
  const cmp = view.comparison;
  const qualityOk =
    entry.freshnessPolicy === "allow-stale" ||
    cmp.qualityState === "fresh";
  if (cmp.direction === "unknown" || cmp.relativeChange === null || !qualityOk) {
    const reason =
      !qualityOk
        ? `source quality is ${cmp.qualityState} (policy: ${entry.freshnessPolicy})`
        : "baseline comparison is UNKNOWN";
    return {
      ...base,
      relativeChangePct: cmp.relativeChange,
      status: "unknown",
      note: `${entry.metricId}: not evaluated — ${reason}`,
    };
  }

  const relativePct = cmp.relativeChange * 100;
  const directionMet = entry.direction === "increase" ? relativePct >= 0 : relativePct <= 0;
  const magnitudeMet = Math.abs(relativePct) >= entry.relativePctThreshold;
  const sign = entry.direction === "increase" ? "+" : "-";
  const fired = directionMet && magnitudeMet;
  return {
    ...base,
    relativeChangePct: relativePct,
    status: fired ? "fired" : "clear",
    note: fired
      ? `${entry.metricId} ${sign}${Math.abs(relativePct).toFixed(1)}% vs baseline — threshold ${sign}${entry.relativePctThreshold}% met`
      : `${entry.metricId} ${sign}${Math.abs(relativePct).toFixed(1)}% vs baseline — below the ${sign}${entry.relativePctThreshold}% threshold`,
  };
}

/** Evaluate a full watchlist against a snapshot provider (deterministic order). */
export function evaluateWatchlist(
  entries: readonly WatchlistEntry[],
  snapshotFor: (chokepointId: string) => ChokepointSnapshot | null,
): WatchEvaluation[] {
  return entries.map((entry) => {
    const snapshot = snapshotFor(entry.chokepointId);
    if (!snapshot) {
      return {
        entryId: entry.id,
        status: "unavailable" as const,
        note: `${entry.chokepointId}: profile unavailable — not evaluated`,
        observedValue: null,
        baselineValue: null,
        relativeChangePct: null,
      };
    }
    return evaluateWatchEntry(entry, snapshot);
  });
}
