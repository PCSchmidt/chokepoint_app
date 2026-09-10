/**
 * Freight HUD — metric cards (CHOKEPOINT-PLAN.md §4.2, §9.2 src/ui, §9.3 badges).
 *
 * View models are PURE (node-testable); render() is a thin DOM writer. Badge
 * vocabulary is exactly §9.3: LIVE, DERIVED, ESTIMATE, SIM, STALE, UNKNOWN —
 * mapped from truth state + health, never invented per card. Red is reserved
 * for degraded/threshold conditions, never generic emphasis (§9.3).
 */

import type { ChokepointSnapshot } from "../data/manager";
import type { DerivedMetric } from "../analytics/metrics";

export type Badge = "LIVE" | "DERIVED" | "ESTIMATE" | "SIM" | "STALE" | "UNKNOWN";

export interface MetricCard {
  id: string;
  label: string;
  /** Display value; null renders as "—" with an UNKNOWN badge (§3.3). */
  value: string;
  /** Raw numeric for tests/agents; mirrors the metric. */
  raw: number | null;
  unit: string;
  badge: Badge;
  /** Short reason when the badge is UNKNOWN/STALE (from the metric itself). */
  note: string | null;
  formulaVersion: string;
}

function badgeFor(metric: DerivedMetric): Badge {
  if (metric.value === null || metric.quality.state === "unknown") return "UNKNOWN";
  if (metric.quality.state === "stale") return "STALE";
  // All Phase 2 metrics are DERIVED from observations (SIMULATED in fixture
  // mode -> the SIM badge, §9.3, so simulated data never reads as live).
  return "DERIVED";
}

function formatValue(metric: DerivedMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "fraction") return `${Math.round(metric.value * 100)}%`;
  if (Number.isInteger(metric.value)) return String(metric.value);
  return metric.value.toFixed(1);
}

function noteFor(metric: DerivedMetric): string | null {
  if (metric.value === null) return metric.quality.coverageNote;
  if (metric.quality.state === "unknown") return metric.quality.coverageNote;
  return null;
}

export function metricCards(snapshot: ChokepointSnapshot): MetricCard[] {
  const m = snapshot.metrics;
  const cards: MetricCard[] = [
    {
      id: "vessel-count",
      label: "Observed freight vessels (defined geofence)",
      value: formatValue(m.vesselCount),
      raw: m.vesselCount.value,
      unit: m.vesselCount.unit,
      badge: badgeFor(m.vesselCount),
      note: noteFor(m.vesselCount),
      formulaVersion: m.vesselCount.formulaVersion,
    },
    {
      id: "moving-fraction",
      label: "Moving (>0.5 kn)",
      value: formatValue(m.movingFraction),
      raw: m.movingFraction.value,
      unit: m.movingFraction.unit,
      badge: badgeFor(m.movingFraction),
      note: noteFor(m.movingFraction),
      formulaVersion: m.movingFraction.formulaVersion,
    },
    {
      id: "dwell-cohort",
      label: "Waiting cohort (est. dwell)",
      value: formatValue(m.dwellCohortSize),
      raw: m.dwellCohortSize.value,
      unit: m.dwellCohortSize.unit,
      badge: badgeFor(m.dwellCohortSize),
      note: noteFor(m.dwellCohortSize),
      formulaVersion: m.dwellCohortSize.formulaVersion,
    },
    {
      id: "dwell-median",
      label: "Median dwell (est.)",
      value: formatValue(m.dwellMedianSeconds),
      raw: m.dwellMedianSeconds.value,
      unit: m.dwellMedianSeconds.unit,
      badge: badgeFor(m.dwellMedianSeconds),
      note: noteFor(m.dwellMedianSeconds),
      formulaVersion: m.dwellMedianSeconds.formulaVersion,
    },
    {
      id: "entry-count",
      label: "Entries (primary fence)",
      value: formatValue(m.entryCount),
      raw: m.entryCount.value,
      unit: m.entryCount.unit,
      badge: badgeFor(m.entryCount),
      note: noteFor(m.entryCount),
      formulaVersion: m.entryCount.formulaVersion,
    },
    {
      id: "exit-count",
      label: "Exits",
      value: formatValue(m.exitCount),
      raw: m.exitCount.value,
      unit: m.exitCount.unit,
      badge: badgeFor(m.exitCount),
      note: noteFor(m.exitCount),
      formulaVersion: m.exitCount.formulaVersion,
    },
  ];
  return cards;
}

/** Comparison line under the card (§8.4 COMPARISON claims carry the baseline). */
export function comparisonLine(comparison: {
  direction: string;
  relativeChange: number | null;
  qualityState: string;
}): string {
  if (comparison.direction === "unknown" || comparison.relativeChange === null) {
    return "vs prior comparable window: UNKNOWN";
  }
  if (comparison.direction === "stable") return "vs prior comparable window: stable";
  const pct = `${Math.round(Math.abs(comparison.relativeChange) * 100)}%`;
  return `vs prior comparable window: ${comparison.direction === "increase" ? "+" : "−"}${pct} (${comparison.direction})`;
}

/** Render cards into a container (thin DOM writer). */
export function renderFreightHud(container: HTMLElement, snapshot: ChokepointSnapshot, truthStateBadge: Badge = "SIM"): void {
  container.innerHTML = "";
  const modeBadge = document.createElement("span");
  modeBadge.className = "badge badge-mode";
  // Fixture mode is labeled SIM everywhere it is visible (§3.1).
  modeBadge.textContent = truthStateBadge;
  modeBadge.dataset.testid = "mode-badge";
  container.appendChild(modeBadge);

  for (const card of metricCards(snapshot)) {
    const el = document.createElement("div");
    el.className = "metric-card";
    el.dataset.testid = `card-${card.id}`;
    const value = document.createElement("div");
    value.className = "metric-value";
    value.textContent = card.value;
    const label = document.createElement("div");
    label.className = "metric-label";
    label.textContent = card.label;
    const badge = document.createElement("span");
    badge.className = `badge badge-${card.badge.toLowerCase()}`;
    badge.textContent = card.badge;
    label.appendChild(badge);
    if (card.note) {
      const note = document.createElement("div");
      note.className = "metric-note";
      note.textContent = card.note;
      el.appendChild(note);
    }
    el.appendChild(value);
    el.appendChild(label);
    container.appendChild(el);
  }
}
