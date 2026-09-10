/**
 * Evidence drawer (CHOKEPOINT-PLAN.md §4.5, §9.2 src/ui/evidenceDrawer.ts).
 *
 * Every metric's provenance, formula, scope, coverage, and the profile's
 * documented limitations — useful without reading code or logs. Language is
 * assembled from data only (§14.4): no causal claims, no explanations beyond
 * what the metric records about itself.
 */

import type { ChokepointSnapshot } from "../data/manager";
import type { ProvenanceRecord } from "../data/provenance";

export interface EvidenceSection {
  title: string;
  lines: string[];
}

export function evidenceSections(snapshot: ChokepointSnapshot): EvidenceSection[] {
  const sections: EvidenceSection[] = [];

  const metricLines = Object.values(snapshot.metrics).map(
    (m) => `${m.metricType}: ${m.value === null ? "UNKNOWN" : String(m.value)} ${m.unit} — formula ${m.formulaVersion} — ${m.quality.coverageNote}`
  );
  sections.push({ title: "Metrics and formulas", lines: metricLines });

  sections.push({
    title: "Comparison",
    lines: [
      `current window ${snapshot.window.startAt} .. ${snapshot.window.endAt}`,
      `baseline window ${snapshot.baselineWindow.startAt} .. ${snapshot.baselineWindow.endAt}`,
      `vessel count vs baseline: ${snapshot.comparisons.vesselCount.direction} (${snapshot.comparisons.vesselCount.qualityState})`,
      `moving fraction vs baseline: ${snapshot.comparisons.movingFraction.direction}`,
    ],
  });

  if (snapshot.events.length > 0) {
    sections.push({
      title: "Detected events (threshold crossings only — no cause is claimed)",
      lines: snapshot.events.map(
        (e) => `${e.eventType}: ${e.baselineValue} -> ${e.currentValue} (${e.quality.coverageNote})`
      ),
    });
  } else {
    sections.push({
      title: "Detected events",
      lines: ["No event rules fired for this window."],
    });
  }

  const provenanceLines = snapshot.provenance.map((p) => provenanceLine(p));
  sections.push({
    title: "Provenance",
    lines: [
      ...provenanceLines,
      `Truth state of inputs: ${snapshot.attribution.truthState}`,
      `Attribution: ${snapshot.attribution.attributionText}`,
      `Coverage: ${snapshot.attribution.coverageNote}`,
    ],
  });

  sections.push({
    title: "Known limitations",
    lines: [...snapshot.profile.limitations],
  });

  return sections;
}

export function provenanceLine(p: ProvenanceRecord): string {
  return (
    `${p.providerId} (${p.endpointId}) — observed ${p.observationInterval.startAt} .. ${p.observationInterval.endAt} — ` +
    `transformation ${p.transformationVersion} — license ${p.licenseId} — truth state ${p.truthState}`
  );
}

export function renderEvidenceDrawer(container: HTMLElement, snapshot: ChokepointSnapshot): void {
  container.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = "Evidence";
  container.appendChild(heading);
  for (const section of evidenceSections(snapshot)) {
    const box = document.createElement("details");
    box.className = "evidence-section";
    box.dataset.testid = `evidence-${section.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    const summary = document.createElement("summary");
    summary.textContent = section.title;
    box.appendChild(summary);
    const list = document.createElement("ul");
    for (const line of section.lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.appendChild(item);
    }
    box.appendChild(list);
    container.appendChild(box);
  }
}
