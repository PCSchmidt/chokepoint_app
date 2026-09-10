/**
 * @vitest-environment happy-dom
 *
 * UI render tests (§4.2, §4.5, §9.3): the DOM writers produce the §9.3 badges,
 * honest states, and threshold-only event language. View models come from real
 * manager snapshots over SIMULATED fixtures.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import { renderFreightHud, metricCards } from "../../src/ui/freightHud";
import { renderMissionLauncher, launcherCards } from "../../src/ui/missionLauncher";
import { renderEvidenceDrawer } from "../../src/ui/evidenceDrawer";
import { renderEventCards } from "../../src/overlays/eventCards";

const WINDOW = { startAt: "2026-09-09T12:00:00Z", endAt: "2026-09-09T15:20:00Z" };

describe("freight HUD render (§4.2, §9.3)", async () => {
  const manager = await createDataManager({ mode: "fixture" });
  const snapshot = manager.getSnapshot("long-beach-approach", WINDOW);

  it("renders one card per §4.2 component metric with a §9.3 badge", () => {
    const container = document.createElement("div");
    renderFreightHud(container, snapshot);
    expect(container.querySelectorAll(".metric-card").length).toBe(6);
    // Fixture mode: the SIM badge is visible (§3.1).
    expect(container.querySelector<HTMLElement>("[data-testid=mode-badge]")!.textContent).toBe("SIM");
    const badges = [...container.querySelectorAll<HTMLElement>(".badge")].map((b) => b.textContent);
    for (const badge of badges) {
      expect(["LIVE", "DERIVED", "ESTIMATE", "SIM", "STALE", "UNKNOWN"]).toContain(badge);
    }
  });

  it("null metrics render UNKNOWN, never fake numbers (§3.3)", () => {
    for (const card of metricCards(snapshot)) {
      if (card.raw === null) expect(card.badge).toBe("UNKNOWN");
      expect(card.formulaVersion).toBeTruthy();
    }
  });
});

describe("mission launcher render (§4.1)", async () => {
  const manager2 = await createDataManager({ mode: "fixture" });

  it("renders a card per chokepoint with honest coverage text", () => {
    const container = document.createElement("div");
    const cards = launcherCards(manager2.listChokepoints(), (f) => manager2.coverageHint(f));
    renderMissionLauncher(container, cards, () => {});
    expect(container.querySelectorAll(".launcher-card").length).toBe(5);
    const suez = container.querySelector<HTMLElement>("[data-testid=launcher-suez-canal-approaches]")!;
    expect(suez.textContent).toMatch(/UNKNOWN/);
    const lb = container.querySelector<HTMLElement>("[data-testid=launcher-long-beach-approach]")!;
    expect(lb.textContent).toMatch(/observed/);
  });

  it("clicking a card selects that chokepoint", () => {
    const container = document.createElement("div");
    const cards = launcherCards(manager2.listChokepoints(), (f) => manager2.coverageHint(f));
    let selected: string | null = null;
    renderMissionLauncher(container, cards, (id) => {
      selected = id;
    });
    (container.querySelector<HTMLElement>("[data-testid=launcher-singapore-malacca-approach]") as HTMLElement).click();
    expect(selected).toBe("singapore-malacca-approach");
  });
});

describe("evidence drawer render (§4.5)", async () => {
  const manager3 = await createDataManager({ mode: "fixture" });
  const snapshot = manager3.getSnapshot("long-beach-approach", WINDOW);

  it("exposes metrics, provenance, and limitations as inspectable sections", () => {
    const container = document.createElement("div");
    renderEvidenceDrawer(container, snapshot);
    const sections = [...container.querySelectorAll("details")].map((s) => s.querySelector("summary")!.textContent);
    expect(sections).toContain("Metrics and formulas");
    expect(sections).toContain("Provenance");
    expect(sections).toContain("Known limitations");
    // §14.4: no causal language anywhere in the drawer.
    expect(container.textContent!.toLowerCase()).not.toContain("because");
  });

  it("the truth state of the inputs is stated explicitly", () => {
    const container = document.createElement("div");
    renderEvidenceDrawer(container, snapshot);
    expect(container.textContent).toMatch(/SIMULATED/);
  });
});

describe("event cards render (§2.2 bounded cohort)", async () => {
  const manager4 = await createDataManager({ mode: "fixture" });
  const snapshot = manager4.getSnapshot("long-beach-approach", WINDOW);

  it("renders zero or bounded cards with threshold language only", () => {
    const container = document.createElement("div");
    renderEventCards(container, snapshot.events, snapshot.comparisons.vesselCount);
    const text = container.textContent!;
    expect(text).not.toMatch(/because|caused by|disruption|suspicious|threat/i);
    if (snapshot.events.length === 0) {
      expect(text).toMatch(/No events fired/);
    } else {
      expect(container.querySelectorAll(".event-card").length).toBeLessThanOrEqual(6);
    }
  });
});
