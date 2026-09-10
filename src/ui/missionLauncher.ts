/**
 * Mission launcher (CHOKEPOINT-PLAN.md §4.1, §9.2 src/ui/missionLauncher.ts).
 *
 * First-run working surface (§9.3): the landing view IS the working app. Cards
 * come from the config registry (§4.3), never from UI conditionals. Coverage
 * hints (§6.1 smoke evidence) surface as honest states: Suez renders
 * "coverage unknown", not a fake empty live view.
 */


export interface LauncherCard {
  id: string;
  name: string;
  region: string;
  mode: import("../config/chokepoints").TransportMode;
  fenceCount: number;
  /** Per-fence live coverage hints from §6.1 evidence. */
  coverage: Array<{ fenceId: string; hint: "covered" | "unknown" }>;
  /** Aggregate presentation state for the card. */
  coverageState: "covered" | "partial" | "unknown";
  limitationCount: number;
}

export function launcherCards(
  profiles: readonly {
    id: string;
    name: string;
    region: string;
    mode: import("../config/chokepoints").TransportMode;
    geofences: readonly { id: string }[];
    limitations: readonly string[];
  }[],
  coverageHint: (fenceId: string) => "covered" | "unknown",
): LauncherCard[] {
  return profiles.map((p) => {
    const coverage = p.geofences.map((g) => ({ fenceId: g.id, hint: coverageHint(g.id) }));
    const covered = coverage.filter((c) => c.hint === "covered").length;
    const state = covered === coverage.length ? "covered" : covered === 0 ? "unknown" : "partial";
    return {
      id: p.id,
      name: p.name,
      region: p.region,
      mode: p.mode,
      fenceCount: p.geofences.length,
      coverage,
      coverageState: state,
      limitationCount: p.limitations.length,
    };
  });
}

export function renderMissionLauncher(
  container: HTMLElement,
  cards: readonly LauncherCard[],
  onSelect: (chokepointId: string) => void,
): void {
  container.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Choose an investigation";
  container.appendChild(heading);
  for (const card of cards) {
    const el = document.createElement("button");
    el.className = "launcher-card";
    el.dataset.testid = `launcher-${card.id}`;
    const name = document.createElement("div");
    name.className = "launcher-name";
    name.textContent = card.name;
    const meta = document.createElement("div");
    meta.className = "launcher-meta";
    meta.textContent = `${card.region} · ${card.fenceCount} geofence(s)`;
    const coverage = document.createElement("div");
    coverage.className = `launcher-coverage coverage-${card.coverageState}`;
    // Mode-aware signal vocabulary: AIS for sea, ADS-B for air, wait times for
    // land (the underlying provider differs by mode; the honest-state logic is
    // identical and data-driven).
    const signal =
      card.mode === "sea" ? "Live AIS coverage" : card.mode === "air" ? "Live ADS-B coverage" : "Live border-wait coverage";
    coverage.textContent =
      card.coverageState === "covered"
        ? `${signal}: observed (§6.1 smoke evidence)`
        : card.coverageState === "partial"
          ? `${signal}: partial — some fences unknown`
          : `${signal}: UNKNOWN — long windows needed; not zero (§3.3)`;
    el.appendChild(name);
    el.appendChild(meta);
    el.appendChild(coverage);
    el.addEventListener("click", () => onSelect(card.id));
    container.appendChild(el);
  }
}
