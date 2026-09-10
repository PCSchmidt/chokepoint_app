/**
 * Watchlist surface (CHOKEPOINT-PLAN.md Workflow E, §9.2 src/ui).
 *
 * Two pieces:
 *  - Save form (investigation view): record chokepoint + metric + threshold +
 *    freshness policy (Workflow E step 2).
 *  - Watch panel (launcher view): saved watches with deterministic local
 *    evaluation against the replay dataset — threshold-crossing language only
 *    (Workflow E step 4; §14.4). No external notifications exist (§11.3).
 */

import {
  WATCH_METRIC_LABELS,
  type WatchEvaluation,
  type WatchMetricId,
  type WatchlistEntry,
} from "../app/watchlist";

export interface WatchlistSaveSelection {
  metricId: WatchMetricId;
  direction: "increase" | "decrease";
  relativePctThreshold: number;
  freshnessPolicy: "require-fresh" | "allow-stale";
}

const STATUS_BADGE: Readonly<Record<WatchEvaluation["status"], string>> = {
  fired: "FIRED",
  clear: "CLEAR",
  unknown: "UNKNOWN",
  unavailable: "UNAVAILABLE",
};

export function renderWatchlistSaveForm(
  container: HTMLElement,
  chokepointName: string,
  onSave: (selection: WatchlistSaveSelection) => void,
): void {
  container.innerHTML = "";
  const details = document.createElement("details");
  details.className = "watch-save";
  details.dataset.testid = "watch-save";
  const summary = document.createElement("summary");
  summary.textContent = `Watch ${chokepointName}`;
  details.appendChild(summary);

  const metric = document.createElement("select");
  metric.dataset.testid = "watch-metric";
  for (const [id, label] of Object.entries(WATCH_METRIC_LABELS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    metric.appendChild(opt);
  }
  const direction = document.createElement("select");
  direction.dataset.testid = "watch-direction";
  for (const [value, label] of [
    ["increase", "rises by"],
    ["decrease", "falls by"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    direction.appendChild(opt);
  }
  const pct = document.createElement("input");
  pct.type = "number";
  pct.min = "1";
  pct.max = "500";
  pct.step = "1";
  pct.value = "10";
  pct.dataset.testid = "watch-threshold";
  pct.setAttribute("aria-label", "Relative change threshold in percent");
  const pctLabel = document.createElement("span");
  pctLabel.textContent = "% vs baseline when";

  const freshness = document.createElement("select");
  freshness.dataset.testid = "watch-freshness";
  for (const [value, label] of [
    ["require-fresh", "only when fresh"],
    ["allow-stale", "allow stale/degraded"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    freshness.appendChild(opt);
  }

  const save = document.createElement("button");
  save.dataset.testid = "watch-save-btn";
  save.textContent = "Save watch";
  save.addEventListener("click", () => {
    const threshold = Number(pct.value);
    if (!Number.isFinite(threshold) || threshold <= 0) return;
    onSave({
      metricId: metric.value as WatchMetricId,
      direction: direction.value as "increase" | "decrease",
      relativePctThreshold: threshold,
      freshnessPolicy: freshness.value as "require-fresh" | "allow-stale",
    });
    save.textContent = "Watch saved";
    window.setTimeout(() => {
      save.textContent = "Save watch";
    }, 1500);
  });

  const row1 = document.createElement("div");
  row1.className = "watch-row";
  row1.append(metric, direction, pct, pctLabel);
  const row2 = document.createElement("div");
  row2.className = "watch-row";
  row2.append(freshness, save);
  const form = document.createElement("div");
  form.append(row1, row2);
  details.appendChild(form);
  container.appendChild(details);
}

export function renderWatchlistPanel(
  container: HTMLElement,
  entries: readonly WatchlistEntry[],
  evaluations: readonly WatchEvaluation[],
  onRemove: (id: string) => void,
): void {
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Watchlist";
  heading.dataset.testid = "watchlist-heading";
  container.appendChild(heading);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "watch-empty";
    empty.dataset.testid = "watchlist-empty";
    empty.textContent =
      "No saved watches. Open a chokepoint and save one — evaluated locally against the replay dataset; nothing leaves this device.";
    container.appendChild(empty);
    return;
  }
  const byId = new Map(evaluations.map((e) => [e.entryId, e]));
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "watch-row-item";
    row.dataset.testid = `watch-${entry.id}`;
    const status = byId.get(entry.id);
    const badge = document.createElement("span");
    badge.className = `badge watch-status watch-${status?.status ?? "unknown"}`;
    badge.textContent = STATUS_BADGE[status?.status ?? "unknown"];
    const label = document.createElement("span");
    label.className = "watch-label";
    label.textContent = `${entry.chokepointId} · ${entry.metricId} ${entry.direction === "increase" ? "+" : "-"}${entry.relativePctThreshold}%`;
    const note = document.createElement("div");
    note.className = "watch-note";
    note.textContent = status?.note ?? "Not evaluated";
    const remove = document.createElement("button");
    remove.dataset.testid = `watch-remove-${entry.id}`;
    remove.className = "watch-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => onRemove(entry.id));
    row.append(badge, label, remove, note);
    container.appendChild(row);
  }
}
