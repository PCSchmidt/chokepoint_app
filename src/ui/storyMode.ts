/**
 * Guided story mode (NETWORK-VIEW-PLAN.md Phase 1.5 P6).
 *
 * A deterministic 4-step tour over the network view. Every caption is
 * assembled from snapshot values — metric numbers, comparison state, and
 * LIMITATION text — so the tour models the project's honest voice (§8, §14.4):
 * it says "observed", carries caveats, and treats UNKNOWN coverage as the
 * story instead of papering over it. No causal or predictive language.
 *
 * buildStorySteps is pure (node-testable); renderStoryBar is a thin DOM
 * writer. Step application (focus + camera) flows through app state in
 * main.ts — the tour never mutates the scene directly.
 */

import type { ChokepointSnapshot } from "../data/manager";

export interface StoryStep {
  /** Chokepoint to focus; null = whole-network step. */
  focusId: string | null;
  title: string;
  caption: string;
}

/**
 * Build the tour from REAL snapshot values. Deterministic: same snapshots in,
 * same steps out. The network step is first; the honest-coverage step (Suez)
 * and the multimodal step (land) close the tour with LIMITATION language.
 */
export function buildStorySteps(snaps: readonly ChokepointSnapshot[]): StoryStep[] {
  const byId = new Map(snaps.map((s) => [s.profile.id, s]));
  const lb = byId.get("long-beach-approach");
  const sg = byId.get("singapore-malacca-approach");
  const suez = byId.get("suez-canal-approaches");
  const land = snaps.find((s) => s.profile.mode === "land");

  const steps: StoryStep[] = [];

  // Step 1: the whole system.
  const seaCount = snaps
    .filter((s) => s.profile.mode === "sea")
    .reduce((n, s) => n + (s.metrics.vesselCount.value ?? 0), 0);
  steps.push({
    focusId: null,
    title: "One system, five chokepoints",
    caption:
      `The network view shows every profile at once: ${seaCount} observed freight vessels across the ` +
      `three maritime fences in this window, plus an air and a land node. Corridor arcs are ` +
      `illustrative trade lanes — not tracked vessel paths.`,
  });

  // Step 2: the waiting cohort at the busiest maritime profile.
  if (lb) {
    const vc = lb.metrics.vesselCount.value;
    const dwell = lb.metrics.dwellCohortSize.value;
    steps.push({
      focusId: lb.profile.id,
      title: "Los Angeles / Long Beach: where ships wait",
      caption:
        `Observed ${vc ?? "unknown"} vessels in the defined geofence. The amber pulse marks the ` +
        `waiting cohort: ${dwell ?? "unknown"} vessel(s) inside the anchorage fence. Dwell is an ` +
        `estimate from first-to-last observation — not official port dwell time.`,
    });
  }

  // Step 3: contrast + comparison honesty.
  if (sg) {
    const c = sg.comparisons.vesselCount;
    const compText =
      c.direction === "unknown" || c.relativeChange === null
        ? "the baseline comparison is UNKNOWN for this window"
        : `the direction vs the prior comparable window is ${c.direction}`;
    steps.push({
      focusId: sg.profile.id,
      title: "Singapore / Malacca: the other anchor of the corridor",
      caption:
        `Observed ${sg.metrics.vesselCount.value ?? "unknown"} vessels in the strait corridor. ` +
        `Compared with the prior comparable window: ${compText}. All inputs are SIMULATED fixtures ` +
        `badged SIM — never presented as live data (§3.1).`,
    });
  }

  // Step 4: honest coverage (LIMITATION as content).
  if (suez) {
    steps.push({
      focusId: suez.profile.id,
      title: "Suez: what the data cannot say",
      caption:
        `The count here is UNKNOWN, not zero: no usable observations exist in this window, and ` +
        `"coverage unknown" is never rendered as "no activity" (§3.3). Long windows are needed ` +
        `before this fence can support conclusions.`,
    });
  }

  // Step 5: multimodal honesty.
  if (land) {
    const waits = land.facilityMetrics.length;
    steps.push({
      focusId: land.profile.id,
      title: "Beyond the water: border waits",
      caption:
        waits > 0
          ? `The land node reports CBP commercial-vehicle wait minutes — OBSERVED facility readings ` +
            `carrying the SIM badge in fixture mode. They are never mixed into maritime vessel counts ` +
            `(ADR-0015).`
          : `The land node has no usable facility readings in this window — shown as UNKNOWN, not zero.`,
    });
  }

  return steps;
}

/** Thin DOM writer: the story bar (bottom of the globe pane). */
export function renderStoryBar(
  container: HTMLElement,
  step: StoryStep,
  index: number,
  total: number,
  actions: { onPrev: () => void; onNext: () => void; onExit: () => void },
): void {
  container.innerHTML = "";
  const el = document.createElement("div");
  el.className = "story-bar";
  el.dataset.testid = "story-bar";
  const title = document.createElement("div");
  title.className = "story-title";
  title.textContent = `${index + 1}/${total} — ${step.title}`;
  const caption = document.createElement("div");
  caption.className = "story-caption";
  caption.textContent = step.caption;
  const controls = document.createElement("div");
  controls.className = "story-controls";
  const prev = document.createElement("button");
  prev.textContent = "← Back";
  prev.disabled = index === 0;
  prev.addEventListener("click", actions.onPrev);
  const next = document.createElement("button");
  next.textContent = index === total - 1 ? "Finish" : "Next →";
  next.dataset.testid = "story-next";
  next.addEventListener("click", actions.onNext);
  const exit = document.createElement("button");
  exit.textContent = "✕";
  exit.dataset.testid = "story-exit";
  exit.title = "Exit story mode";
  exit.addEventListener("click", actions.onExit);
  controls.append(prev, next, exit);
  el.append(title, caption, controls);
  container.appendChild(el);
}
