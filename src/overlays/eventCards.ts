/**
 * Event cards overlay (CHOKEPOINT-PLAN.md §4.1 bounded cohorts, §2.2 Workflow C,
 * §9.2 src/overlays/eventCards.ts).
 *
 * Events render through the render governor: a bounded, deterministic subset
 * (§12.5 overlay budget), newest first by threshold priority. A card claims a
 * threshold crossing and shows its evidence ids — never a cause.
 */

import type { DetectedEvent } from "../analytics/events";
import { selectBoundedCohort, OVERLAY_BUDGETS, type OverlayCandidate } from "../scene/renderGovernor";
import { comparisonLine } from "../ui/freightHud";
import type { BaselineComparisonView } from "../data/manager";

export interface EventCardCandidate extends OverlayCandidate {
  event: DetectedEvent;
}

export interface EventCardView {
  eventId: string;
  eventType: string;
  headline: string;
  detail: string;
  dropped: number;
}

export function eventCardCandidates(events: readonly DetectedEvent[]): OverlayCandidate[] {
  // Priority: magnitude of relative change; ties break by stable id inside
  // selectBoundedCohort. No clock involvement.
  return events.map((e) => ({ id: e.eventId, priority: Math.abs(e.relativeChange ?? 0) }));
}

export function eventCardViewModel(
  events: readonly DetectedEvent[],
  maxCount: number = OVERLAY_BUDGETS.eventCards,
): { cards: Array<{ eventId: string; eventType: string; headline: string }>; dropped: number } {
  const selection = selectBoundedCohort(
    events.map((e) => ({ id: e.eventId, priority: Math.abs(e.relativeChange ?? 0), event: e })),
    maxCount,
  );
  return {
    cards: selection.selected.map((s) => {
      const e = s.event;
      const pct = e.relativeChange === null ? "n/a" : `${Math.round(Math.abs(e.relativeChange) * 100)}%`;
      return {
        eventId: e.eventId,
        eventType: e.eventType,
        headline: `${e.eventType.replace(/_/g, " ")}: ${e.baselineValue} -> ${e.currentValue} (${pct})`,
      };
    }),
    dropped: selection.dropped,
  };
}

export function renderEventCards(
  container: HTMLElement,
  events: readonly DetectedEvent[],
  comparison: BaselineComparisonView,
): void {
  container.innerHTML = "";
  const vm = eventCardViewModel(events);
  for (const card of vm.cards) {
    const el = document.createElement("div");
    el.className = "event-card";
    el.dataset.testid = `event-${card.eventType}`;
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = card.headline;
    const note = document.createElement("div");
    note.className = "event-note";
    note.textContent = "Threshold crossing — see evidence for formulas and caveats.";
    el.appendChild(title);
    el.appendChild(note);
    container.appendChild(el);
  }
  if (vm.cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "event-empty";
    empty.textContent = "No events fired in this window.";
    container.appendChild(empty);
  }
  // Comparison context under the cards (§8.4): derived from the baseline pair.
  const comparisonEl = document.createElement("div");
  comparisonEl.className = "event-comparison";
  comparisonEl.textContent = comparisonLine(comparison);
  container.appendChild(comparisonEl);
}
