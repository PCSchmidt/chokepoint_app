/**
 * Compare table (NETWORK-VIEW-PLAN.md Phase 1 step 4 / Phase 1.5 P5).
 *
 * The network view's left rail: one row per registry profile with a
 * mode-aware headline metric, honest badges, and a comparison line. Pure
 * view-model functions are node-testable; renderCompareTable is a thin DOM
 * writer (same pattern as renderMissionLauncher).
 *
 * Headline selection is MODE-AWARE (§3.3): land profiles (CBP border waits,
 * ADR-0013) have empty entity metrics — their headline comes from
 * facilityCards. Rendering "—" across the board for El Paso would read as
 * "no activity", which is exactly the §3.3 violation the badge vocabulary
 * exists to prevent.
 */

import type { ChokepointSnapshot } from "../data/manager";
import type { MetricCard } from "./freightHud";
import { metricCards, facilityCards } from "./freightHud";
import { selectBoundedCohort, OVERLAY_BUDGETS, type OverlayCandidate } from "../scene/renderGovernor";
import type { TransportObservation } from "../data/observation";

// ---------------------------------------------------------------------------
// Merged observations (the showObservations clobber fix)
// ---------------------------------------------------------------------------

export interface MergedObservations {
  observations: TransportObservation[];
  /** Per-profile drop counts (visible for "n more" honesty, §4.1). */
  droppedPerProfile: Record<string, number>;
}

/**
 * Merge observations across ALL profile snapshots into ONE drawable set.
 *
 * globe.showObservations removes every entity whose id contains "@" before
 * drawing, so it must be called ONCE with the merged set — sequential
 * per-profile calls would leave only the last profile's points. The merge is
 * bounded per profile via the render governor (deterministic, stable across
 * frames), so live mode inherits the §12.5 overlay budget for free.
 */
export function networkObservations(snapshots: readonly ChokepointSnapshot[]): MergedObservations {
  const profiles = snapshots.filter((s) => s.observations.length > 0);
  const perProfileBudget =
    profiles.length === 0
      ? OVERLAY_BUDGETS.vesselPoints
      : Math.max(1, Math.floor(OVERLAY_BUDGETS.vesselPoints / profiles.length));
  const observations: TransportObservation[] = [];
  const droppedPerProfile: Record<string, number> = {};
  for (const snap of profiles) {
    const candidates: Array<OverlayCandidate & { observation: TransportObservation }> = snap.observations.map(
      (o) => ({
        id: `${o.entityId}@${o.observedAt}`,
        // Newest wins a slot; ties break by stable id inside the governor.
        priority: Date.parse(o.observedAt),
        observation: o,
      }),
    );
    const selection = selectBoundedCohort(candidates, perProfileBudget);
    droppedPerProfile[snap.profile.id] = selection.dropped;
    for (const item of selection.selected) observations.push(item.observation);
  }
  // Stable draw order: observedAt ASC so the scene never reorders mid-replay.
  observations.sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0));
  return { observations, droppedPerProfile };
}

// ---------------------------------------------------------------------------
// Compare rows (mode-aware headline)
// ---------------------------------------------------------------------------

export interface CompareRow {
  chokepointId: string;
  name: string;
  region: string;
  mode: string;
  /** Mode headline card (vessel count for sea, wait minutes for land, ...). */
  headline: MetricCard | null;
  /** Supporting cards shown small in the row (may be empty). */
  secondary: MetricCard[];
  comparisonLine: string | null;
  eventCount: number;
  coverageState: "covered" | "partial" | "unknown";
  /** Honest multimodal limitation text (land/air), null for entity profiles. */
  multimodalNotice: string | null;
  /** Sort priority: magnitude of the largest relative change in the snapshot. */
  anomalyPriority: number;
}

function headlineFor(snapshot: ChokepointSnapshot): { headline: MetricCard | null; secondary: MetricCard[] } {
  if (snapshot.profile.mode === "land") {
    // ADR-0015: facility metrics live OUTSIDE the entity metric list.
    const facility = facilityCards(snapshot, snapshot.health.cbp !== null);
    if (facility.length === 0) return { headline: null, secondary: [] };
    return { headline: facility[0]!, secondary: facility.slice(1) };
  }
  const cards = metricCards(snapshot);
  const headline = cards.find((c) => c.id === "vessel-count") ?? null;
  return { headline, secondary: cards.filter((c) => c.id !== "vessel-count").slice(0, 2) };
}

function coverageStateFor(
  snapshot: ChokepointSnapshot,
  coverageHint: (fenceId: string) => "covered" | "unknown",
): CompareRow["coverageState"] {
  // Injected (manager.coverageHint in the app; §6.1 smoke evidence stays in
  // one place in the data layer — this module does not duplicate it).
  const hints = snapshot.profile.geofences.map((g) => coverageHint(g.id));
  const covered = hints.filter((h) => h === "covered").length;
  return covered === hints.length ? "covered" : covered === 0 ? "unknown" : "partial";
}

function comparisonText(snapshot: ChokepointSnapshot): string | null {
  const c = snapshot.comparisons.vesselCount;
  if (snapshot.profile.mode === "land") return null; // land compares waits, not vessels; waits are OBSERVED, not baselined (ADR-0013)
  if (c.direction === "unknown" || c.relativeChange === null) return "vs baseline: UNKNOWN";
  if (c.direction === "stable") return "vs baseline: stable";
  const pct = `${Math.round(Math.abs(c.relativeChange) * 100)}%`;
  return `vs baseline: ${c.direction === "increase" ? "+" : "−"}${pct}`;
}

/** One row per snapshot; order follows the input (registry order). */
export function compareRows(
  snapshots: readonly ChokepointSnapshot[],
  coverageHint: (fenceId: string) => "covered" | "unknown" = () => "unknown",
): CompareRow[] {
  return snapshots.map((snap) => {
    const { headline, secondary } = headlineFor(snap);
    const eventChanges = snap.events.map((e) => Math.abs(e.relativeChange ?? 0));
    const compChanges = [snap.comparisons.vesselCount, snap.comparisons.movingFraction]
      .map((c) => (c.relativeChange === null ? 0 : Math.abs(c.relativeChange)));
    return {
      chokepointId: snap.profile.id,
      name: snap.profile.name,
      region: snap.profile.region,
      mode: snap.profile.mode,
      headline,
      secondary,
      comparisonLine: comparisonText(snap),
      eventCount: snap.events.length,
      coverageState: coverageStateFor(snap, coverageHint),
      multimodalNotice: snap.multimodalNotice,
      anomalyPriority: Math.max(0, ...eventChanges, ...compChanges),
    };
  });
}

/** Deterministic sort: "most anomalous" first (priority desc, id asc). */
export function sortRowsByAnomaly(rows: readonly CompareRow[]): CompareRow[] {
  return [...rows].sort((a, b) =>
    b.anomalyPriority !== a.anomalyPriority
      ? b.anomalyPriority - a.anomalyPriority
      : a.chokepointId < b.chokepointId
        ? -1
        : 1,
  );
}

export function sortRowsByRegion(rows: readonly CompareRow[]): CompareRow[] {
  return [...rows].sort((a, b) =>
    a.region !== b.region
      ? a.region < b.region
        ? -1
        : 1
      : a.name < b.name
        ? -1
        : 1,
  );
}

// ---------------------------------------------------------------------------
// Sparkline series (P5): headline metric across the DEFAULT window
// ---------------------------------------------------------------------------

/**
 * Headline series per profile over `window`, bucketed deterministically. Each
 * bucket is a REAL manager.getSnapshot over the sub-window — the UI computes
 * nothing itself (every number comes from the tested analytics modules).
 * Computed once per window change, not per replay tick (50 snapshot calls).
 */
export function headlineSeries(
  snapshots: readonly ChokepointSnapshot[],
  snapshotFor: (chokepointId: string, window: { startAt: string; endAt: string }) => ChokepointSnapshot,
  window: { startAt: string; endAt: string },
  buckets = 12,
): Record<string, Array<number | null>> {
  const start = Date.parse(window.startAt);
  const end = Date.parse(window.endAt);
  if (!(end > start)) return {};
  const step = (end - start) / buckets;
  const series: Record<string, Array<number | null>> = {};
  for (const snap of snapshots) {
    const values: Array<number | null> = [];
    for (let i = 0; i < buckets; i++) {
      const sub = { startAt: new Date(start + i * step).toISOString(), endAt: new Date(start + (i + 1) * step).toISOString() };
      const s = snapshotFor(snap.profile.id, sub);
      values.push(s.profile.mode === "land" ? (s.facilityMetrics[0]?.measurements.find((x) => x.laneGroup === "commercial_vehicle" && x.metric === "wait_minutes")?.value ?? null) : s.metrics.vesselCount.value);
    }
    series[snap.profile.id] = values;
  }
  return series;
}

/** Pure sparkline geometry: map a value series onto pixel coordinates. */
export function sparklinePoints(
  values: ReadonlyArray<number | null>,
  width: number,
  height: number,
): Array<[number, number] | null> {
  const finite = values.filter((v): v is number => v !== null);
  if (finite.length === 0) return values.map(() => null);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max > min ? max - min : 1;
  return values.map((v, i) => {
    if (v === null) return null;
    const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return [x, y];
  });
}

function drawSparkline(canvas: HTMLCanvasElement, values: ReadonlyArray<number | null>): void {
  const width = 96;
  const height = 22;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const pts = sparklinePoints(values, width, height);
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for (const p of pts) {
    if (!p) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(p[0], p[1]);
      started = true;
    } else {
      ctx.lineTo(p[0], p[1]);
    }
  }
  ctx.stroke();
  // UNKNOWN buckets get a tick at the baseline, never a fake continuation.
  ctx.fillStyle = "#9ca3af";
  for (let i = 0; i < pts.length; i++) {
    if (pts[i] === null) ctx.fillRect((i / Math.max(1, pts.length - 1)) * (width - 2) + 1, height - 3, 2, 2);
  }
}

// ---------------------------------------------------------------------------
// DOM writer (thin; node-testable via happy-dom)
// ---------------------------------------------------------------------------

export type CompareSort = "anomaly" | "region";

export function renderCompareTable(
  container: HTMLElement,
  rows: readonly CompareRow[],
  onSelect: (chokepointId: string) => void,
  options: {
    sort: CompareSort;
    focusedId: string | null;
    onSortChange?: (sort: CompareSort) => void;
    /** P5: per-profile headline series over the default window. */
    sparklines?: Record<string, ReadonlyArray<number | null>>;
  } = {
    sort: "anomaly",
    focusedId: null,
  },
): void {
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Global network";
  container.appendChild(heading);

  const sortBar = document.createElement("div");
  sortBar.className = "compare-sort";
  for (const sort of ["anomaly", "region"] as const) {
    const btn = document.createElement("button");
    btn.className = `compare-sort-btn${options.sort === sort ? " active" : ""}`;
    btn.dataset.testid = `sort-${sort}`;
    btn.textContent = sort === "anomaly" ? "Most anomalous" : "Region";
    btn.addEventListener("click", () => options.onSortChange?.(sort));
    sortBar.appendChild(btn);
  }
  container.appendChild(sortBar);

  const sorted = options.sort === "anomaly" ? sortRowsByAnomaly(rows) : sortRowsByRegion(rows);
  for (const row of sorted) {
    const el = document.createElement("button");
    el.className = `compare-row${options.focusedId === row.chokepointId ? " focused" : ""}`;
    el.dataset.testid = `compare-${row.chokepointId}`;

    const name = document.createElement("div");
    name.className = "compare-name";
    name.textContent = row.name;
    el.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "compare-meta";
    meta.textContent = `${row.region} · ${row.mode}`;
    el.appendChild(meta);

    const headline = document.createElement("div");
    headline.className = "compare-headline";
    const value = document.createElement("span");
    value.className = "compare-value";
    value.textContent = row.headline ? `${row.headline.value} ` : "— ";
    headline.appendChild(value);
    if (row.headline) {
      const badge = document.createElement("span");
      badge.className = `badge badge-${row.headline.badge.toLowerCase()}`;
      badge.textContent = row.headline.badge;
      headline.appendChild(badge);
      const label = document.createElement("span");
      label.className = "compare-label";
      label.textContent = ` ${row.headline.label}`;
      headline.appendChild(label);
    } else {
      const badge = document.createElement("span");
      badge.className = "badge badge-unknown";
      badge.textContent = "UNKNOWN";
      headline.appendChild(badge);
    }
    el.appendChild(headline);

    if (row.comparisonLine) {
      const comp = document.createElement("div");
      comp.className = "compare-comparison";
      comp.textContent = row.comparisonLine;
      el.appendChild(comp);
    }

    const series = options.sparklines?.[row.chokepointId];
    if (series && series.some((v) => v !== null)) {
      const spark = document.createElement("canvas");
      spark.className = "compare-sparkline";
      spark.dataset.testid = `spark-${row.chokepointId}`;
      drawSparkline(spark, series);
      el.appendChild(spark);
    }

    const coverage = document.createElement("div");
    coverage.className = `compare-coverage coverage-${row.coverageState}`;
    coverage.textContent =
      row.coverageState === "covered"
        ? "Coverage: observed (§6.1 smoke evidence)"
        : row.coverageState === "partial"
          ? "Coverage: partial — some fences unknown"
          : "Coverage: UNKNOWN — long windows needed; not zero (§3.3)";
    el.appendChild(coverage);

    if (row.multimodalNotice) {
      const notice = document.createElement("div");
      notice.className = "compare-notice";
      notice.textContent = row.multimodalNotice;
      el.appendChild(notice);
    }

    el.addEventListener("click", () => onSelect(row.chokepointId));
    container.appendChild(el);
  }
}
