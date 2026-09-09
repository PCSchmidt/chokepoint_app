/**
 * Evaluation report generator (CHOKEPOINT-PLAN.md §12.6, §17 Phase 2 exit,
 * §20 step 8: first evaluation before adding an LLM).
 *
 * Deterministic core: the evaluation clock and scenario data are fixed (see
 * tests/evaluation/detector-scenarios.ts), so re-running the command
 * reproduces the same metric output. Only `generatedAt` reflects the real run
 * time and is kept separate from the evaluation itself.
 *
 * Command: npm run eval
 * Output:  evaluation-reports/evaluation-report-<UTC date>.{json,md}
 */

import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { detectChokepointEvents, DEFAULT_EVENT_RULES, EVENT_DETECTOR_VERSION } from "../src/analytics/events";
import { evaluateDetector } from "../src/analytics/detectorMetrics";
import { compareWithBaseline } from "../src/analytics/baselines";
import {
  EVALUATION_SCENARIOS,
  EVALUATION_LABELS,
  EVALUATION_CLOCK,
  EVALUATION_SCOPE,
  TRUE_NEGATIVE_WINDOWS,
  TOTAL_ENTITY_HOURS,
} from "../tests/evaluation/detector-scenarios";

const root = path.resolve(import.meta.dirname ?? ".", "..");

// --- §12.6 dataset manifest: checked-in fixtures ---
const fixturesDir = path.join(root, "tests", "fixtures");
const datasetManifest = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const manifest = JSON.parse(readFileSync(path.join(fixturesDir, f), "utf-8"));
    return {
      file: f,
      fixtureId: manifest.fixtureId,
      truthState: manifest.truthState,
      simulated: manifest.simulated,
      provenance: manifest.provenance,
      observationCount: manifest.observations.length,
    };
  });

// --- Run the detector exactly as the tests do ---
const events = detectChokepointEvents(EVALUATION_SCOPE, EVALUATION_SCENARIOS, { detectedAt: EVALUATION_CLOCK });
const evaluation = evaluateDetector(events, EVALUATION_LABELS, {
  matchWindowSeconds: 3600,
  totalEntityHours: TOTAL_ENTITY_HOURS,
  trueNegativeWindows: TRUE_NEGATIVE_WINDOWS,
});

// --- Known failures (§12.6): documented, not hidden ---
const knownFailures = [
  {
    id: "KNOWN-1",
    scenario: "E",
    description:
      "A real queue buildup with a single-observation baseline does NOT fire. The detector refuses LOW_SAMPLE comparisons (§3.3); the labeled truth records the event, so it counts as a false negative. This is deliberate: claiming an event from a 1-observation baseline would violate the trust contract.",
    detected: false,
    countedAs: "false_negative",
  },
  {
    id: "KNOWN-2",
    scenario: "geometry",
    description:
      "The Malacca/Singapore strait-traffic-corridor fence is all-approximate (±0.05°, not digitized from IMO Ships' Routeing); entry/exit and vessel counts in that fence carry that geometric uncertainty until a v2 re-derivation (ADR-0011).",
    detected: null,
    countedAs: "geometry_limitation",
  },
];

const report = {
  reportVersion: "evaluation-report-v1",
  generatedAt: new Date().toISOString(),
  evaluationClock: EVALUATION_CLOCK,
  command: "npm run eval",
  // §12.6 dataset manifest
  datasetManifest,
  fixtureProvenance:
    "All fixtures are SIMULATED synthetic data (truthState SIMULATED, generatedBy chokepoint synthetic fixture generator). No real AIS data is used anywhere in this evaluation.",
  // §12.6 metric definitions (versioned)
  metricDefinitions: {
    formulas: {
      moving_fraction: "moving-fraction-v1",
      dwell_estimate: "dwell-estimate-v1",
      entry_exit: "entry-exit-v1",
      vessel_count: "vessel-count-v1",
      baseline_comparison: "baseline-comparison-v1",
      event_detector: EVENT_DETECTOR_VERSION,
      detector_metrics: "detector-metrics-v1",
    },
    classification: "ais-classification-v1",
    rules: DEFAULT_EVENT_RULES,
  },
  // §12.3 metric output
  scope: EVALUATION_SCOPE,
  scenarioCount: EVALUATION_SCENARIOS.length,
  detectedEvents: events.map((e) => ({
    eventId: e.eventId,
    eventType: e.eventType,
    currentValue: e.currentValue,
    baselineValue: e.baselineValue,
    absoluteChange: e.absoluteChange,
    relativeChange: e.relativeChange,
    quality: e.quality,
  })),
  metrics: evaluation,
  knownFailures,
};

// --- Markdown rendering ---
const pct = (v: number | null): string => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const md = `# Chokepoint Detector Evaluation Report (v1)

- Generated: ${report.generatedAt}
- Evaluation clock (deterministic): ${EVALUATION_CLOCK}
- Command: \`npm run eval\`
- Scope: ${EVALUATION_SCOPE} (geofence:outer-anchorage@2026-09-09-v1)
- Detector: ${EVENT_DETECTOR_VERSION} | Metrics: detector-metrics-v1

## Dataset (§12.6 manifest)

All inputs are SIMULATED fixtures; no real AIS data is used.
${datasetManifest.map((d) => `- \`${d.file}\` — ${d.fixtureId} (${d.observationCount} observations)`).join("\n")}

## §12.3 Metrics

| Metric | Value |
|---|---|
| True positives | ${evaluation.truePositives} |
| False positives | ${evaluation.falsePositives} |
| False negatives | ${evaluation.falseNegatives} |
| Precision | ${pct(evaluation.precision)} |
| Recall | ${pct(evaluation.recall)} |
| F1 | ${evaluation.f1 === null ? "n/a" : evaluation.f1.toFixed(3)} |
| FP per entity-hour | ${evaluation.falsePositivesPerEntityHour} (${TOTAL_ENTITY_HOURS} entity-hours) |
| Mean detection latency | ${evaluation.meanDetectionLatencySeconds === null ? "n/a" : `${Math.round(evaluation.meanDetectionLatencySeconds)}s`} |

## Detected events

${report.detectedEvents.map((e) => `- **${e.eventType}**: ${e.baselineValue} → ${e.currentValue} (${e.relativeChange === null ? "n/a" : `${(e.relativeChange * 100).toFixed(0)}%`})`).join("\n")}

## Known failures (§12.6 — documented, not hidden)

${knownFailures.map((f) => `- **${f.id}** (${f.countedAs}): ${f.description}`).join("\n")}

## Interpretation limits

- Thresholds are starter demo values; §12.3 calibration against known historical
  conditions is the documented path to tuning.
- Recall is capped by the LOW_SAMPLE refusal (scenario E): raising recall by
  firing on 1-observation baselines would violate the §3.3 trust contract.
- This report predates any live data; live-source evaluation repeats this
  command after the AISStream adapter lands.
`;

const outDir = path.join(root, "evaluation-reports");
mkdirSync(outDir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const jsonPath = path.join(outDir, `evaluation-report-${date}.json`);
const mdPath = path.join(outDir, `evaluation-report-${date}.md`);
writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
writeFileSync(mdPath, md + "\n");
console.log(`wrote ${path.relative(root, jsonPath)}`);
console.log(`wrote ${path.relative(root, mdPath)}`);
console.log(
  `metrics: TP=${evaluation.truePositives} FP=${evaluation.falsePositives} FN=${evaluation.falseNegatives} ` +
    `precision=${evaluation.precision} recall=${evaluation.recall?.toFixed(3)} f1=${evaluation.f1?.toFixed(3)}`
);
