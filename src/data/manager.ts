/**
 * Data layer manager (CHOKEPOINT-PLAN.md §5.1, §9.2 src/data/manager.ts,
 * §16.1 local-first, §6.2 keyless-first).
 *
 * One object owns source selection and snapshot assembly for the UI:
 *  - fixture mode (default): FixtureSourceAdapter over checked-in SIMULATED
 *    fixtures — always available, keyless (§6.2).
 *  - live mode: AisStreamAdapter requires a server-side key and, from the
 *    browser, the Phase 5 API (§10.1). Without a key the manager reports the
 *    live layer UNAVAILABLE and stays in fixture mode — a missing key must
 *    never make the app appear broken (§6.2).
 *
 * A snapshot is everything an investigation view needs: profile, windowed
 * observations, §7 component metrics, detected events, provenance, and
 * attribution. All numbers come from the tested analytics modules — the UI
 * computes nothing itself. The wall clock is never read: windows are inputs.
 */

import { FixtureSourceAdapter } from "./fixtureAdapter";
import type { FixtureManifest } from "./fixtureLoader";
import { AisStreamAdapter } from "./aisStreamAdapter";
import { REVIEWED_GEOFENCE_REGISTRY, geofenceMembership } from "./geofences";
import type { ReviewedGeofence } from "./geofences";
import { cohortByClassification } from "../analytics/observations";
import {
  vesselCount,
  movingFraction,
  dwellEstimates,
  entryExitCounts,
  type DerivedMetric,
} from "../analytics/metrics";
import { compareWithBaseline } from "../analytics/baselines";
import { detectChokepointEvents } from "../analytics/events";
import type { ProvenanceRecord } from "./provenance";
import type { AttributionRecord, SourceStatus } from "./sourceAdapter";
import { CHOKEPOINT_REGISTRY, getChokepoint, type ChokepointProfile } from "../config/chokepoints";

export type SourceMode = "fixture" | "live";

export interface DataManagerOptions {
  mode: SourceMode;
  /** Server-side AISStream key (host-supplied). Absent -> live is UNAVAILABLE. */
  apiKey?: string | undefined;
  /**
   * Fixture manifests directly (BROWSER path: import.meta.glob over the
   * checked-in SIMULATED fixtures). When omitted, manifests load from
   * fixtureDir via node:fs (node/tests path).
   */
  manifests?: readonly FixtureManifest[] | undefined;
  /** Fixture directory override (node/tests only). Default: tests/fixtures. */
  fixtureDir?: string | undefined;
  nowFn?: () => string;
}

export interface SnapshotMetrics {
  vesselCount: DerivedMetric;
  movingFraction: DerivedMetric;
  dwellCohortSize: DerivedMetric;
  dwellMedianSeconds: DerivedMetric;
  entryCount: DerivedMetric;
  exitCount: DerivedMetric;
}

export interface BaselineComparisonView {
  relativeChange: number | null;
  absoluteChange: number | null;
  direction: "increase" | "decrease" | "stable" | "unknown";
  qualityState: "fresh" | "stale" | "degraded" | "unknown";
  note: string;
}

export interface ChokepointSnapshot {
  profile: ChokepointProfile;
  window: { startAt: string; endAt: string };
  baselineWindow: { startAt: string; endAt: string };
  observations: ReadonlyArray<import("./observation").TransportObservation>;
  freightEntityIds: string[];
  unclassifiedCount: number;
  otherCount: number;
  metrics: SnapshotMetrics;
  comparisons: {
    vesselCount: BaselineComparisonView;
    movingFraction: BaselineComparisonView;
  };
  events: ReturnType<typeof detectChokepointEvents>;
  provenance: ProvenanceRecord[];
  attribution: AttributionRecord;
  sourceMode: SourceMode;
  health: { fixture: SourceStatus; live: SourceStatus | null };
}

export interface DataManager {
  readonly mode: SourceMode;
  readonly liveAvailable: boolean;
  /** All MVP profiles, for the mission launcher (§4.3 config-driven). */
  listChokepoints(): ReadonlyArray<ChokepointProfile>;
  /** Deterministic default window from the fixture timeline. */
  defaultWindow(): { startAt: string; endAt: string };
  getSnapshot(chokepointId: string, window: { startAt: string; endAt: string }): ChokepointSnapshot;
  /** Coarse live-coverage hint per fence from the §6.1 smoke evidence. */
  coverageHint(fenceId: string): "covered" | "unknown";
  destroy(): void;
}

/**
 * Node-side fixture loading (dynamic import keeps node:fs/promises out of the
 * browser bundle entirely).
 */
async function loadFixtureManifestsFromDisk(dir: string): Promise<FixtureManifest[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const manifests: FixtureManifest[] = [];
  for (const file of files) {
    manifests.push(JSON.parse(await readFile(`${dir}/${file}`, "utf-8")) as FixtureManifest);
  }
  return manifests;
}

/** Fence-scoped live-coverage hints from the first smoke evidence (§6.1). */
const SMOKE_COVERAGE_HINTS: Readonly<Record<string, "covered" | "unknown">> = {
  "outer-anchorage": "covered",
  "approach-corridor": "covered",
  "strait-traffic-corridor": "covered",
  "singapore-roadstead": "covered",
  "gulf-of-suez-approach": "unknown", // 0 candidates in the 5-minute smoke window
  "port-said-approach": "unknown",
};
export const COVERAGE_EVIDENCE_SOURCE = "research/smoke/smoke-run-2026-09-09.log (5-minute window; NOT a coverage statistic)";

function primaryFence(profile: ChokepointProfile): ReviewedGeofence {
  // Entry/exit v1 measures against the primary approach-flow fence when one
  // exists (Suez/LB corridors), else the first registered fence (documented).
  const approach = profile.geofences.find((g) => g.purpose === "approach-flow");
  const chosen = approach ?? profile.geofences[0]!;
  const reviewed = REVIEWED_GEOFENCE_REGISTRY.find((f) => f.id === chosen.id);
  if (!reviewed) throw new Error(`fence ${chosen.id} is not registered as reviewed`);
  return reviewed;
}

export function baselineWindowFor(window: { startAt: string; endAt: string }): { startAt: string; endAt: string } {
  const spanMs = Date.parse(window.endAt) - Date.parse(window.startAt);
  if (!(spanMs > 0)) throw new Error("window must have positive span");
  return {
    startAt: new Date(Date.parse(window.startAt) - spanMs).toISOString(),
    endAt: window.startAt,
  };
}

/**
 * Build the manager. Fixture mode is always available; live mode additionally
 * needs a key (server-side, §14.1) — without one the manager still works, with
 * the live layer honestly UNAVAILABLE.
 */
export async function createDataManager(options: DataManagerOptions): Promise<DataManager> {
  // Browser callers pass manifests (import.meta.glob); node callers pass a dir.
  const manifests =
    options.manifests ?? (await loadFixtureManifestsFromDisk(options.fixtureDir ?? "tests/fixtures"));
  const now = options.nowFn?.() ?? "2026-09-09T13:42:00Z"; // fixture serving time default
  const fixtureAdapter = new FixtureSourceAdapter({ manifests });
  await fixtureAdapter.enable({ now, trigger: "startup" });

  const liveAdapter =
    options.mode === "live" && options.apiKey
      ? new AisStreamAdapter({
          apiKey: options.apiKey,
          fences: [...REVIEWED_GEOFENCE_REGISTRY],
          ...(options.nowFn ? { nowFn: options.nowFn } : {}),
        })
      : null;

  const manager: DataManager = {
    mode: options.mode,
    liveAvailable: liveAdapter !== null,
    listChokepoints: () => CHOKEPOINT_REGISTRY,
    defaultWindow: () => {
      const records = fixtureAdapter.getRecords();
      if (records.length === 0) throw new Error("no fixture records loaded");
      return {
        startAt: records[0]!.observedAt,
        endAt: records[records.length - 1]!.observedAt,
      };
    },
    coverageHint: (fenceId) => SMOKE_COVERAGE_HINTS[fenceId] ?? "unknown",
    getSnapshot: (chokepointId, window) => {
      const profile = getChokepoint(chokepointId);
      if (!profile) throw new Error(`unknown chokepoint: ${chokepointId}`);
      const fences = REVIEWED_GEOFENCE_REGISTRY.filter((f) =>
        profile.geofences.some((g) => g.id === f.id)
      );
      if (fences.length === 0) throw new Error(`chokepoint ${chokepointId} has no registered reviewed fences`);
      const computedAt = window.endAt;
      const baselineWindow = baselineWindowFor(window);
      const insideAny = (o: import("./observation").TransportObservation): boolean =>
        fences.some((f) => geofenceMembership(f, o.position.latitude, o.position.longitude).inside);

      const inWindow = fixtureAdapter.getRecords({ timeWindow: window });
      const inBaseline = fixtureAdapter.getRecords({ timeWindow: baselineWindow });
      const inFence = inWindow.filter(insideAny);
      const baselineInFence = inBaseline.filter(insideAny);
      const cohort = cohortByClassification(inFence);
      const baselineCohort = cohortByClassification(baselineInFence);

      const vesselCountMetric = vesselCount(inFence, { computedAt, truthState: "SIMULATED", observationWindow: window, scope: profile.id, fences });
      const movingFractionMetric = movingFraction(inFence, {
        computedAt, truthState: "SIMULATED", observationWindow: window, scope: profile.id,
        speedKnotsThreshold: 0.5,
        ...(cohort.freight.length > 0 ? { entityIds: cohort.freight } : {}),
      });
      const dwell = dwellEstimates(inFence, {
        computedAt, truthState: "SIMULATED", observationWindow: window, scope: profile.id,
        membership: insideAny, minObservations: 2, maxGapSeconds: 3600,
      });
      const entryExit = entryExitCounts(inFence, {
        computedAt, truthState: "SIMULATED", observationWindow: window,
        fence: primaryFence(profile), maxGapSeconds: 3600,
        ...(cohort.freight.length > 0 ? { entityIds: cohort.freight } : {}),
      });

      const baselineVesselCount = vesselCount(baselineInFence, { computedAt, truthState: "SIMULATED", observationWindow: baselineWindow, scope: profile.id, fences });
      const baselineMoving = movingFraction(baselineInFence, {
        computedAt, truthState: "SIMULATED", observationWindow: baselineWindow, scope: profile.id,
        speedKnotsThreshold: 0.5,
        ...(baselineCohort.freight.length > 0 ? { entityIds: baselineCohort.freight } : {}),
      });
      const baselineDwell = dwellEstimates(baselineInFence, {
        computedAt, truthState: "SIMULATED", observationWindow: baselineWindow,
        membership: insideAny, minObservations: 2, maxGapSeconds: 3600,
      });
      const baselineEntry = entryExitCounts(baselineInFence, {
        computedAt, truthState: "SIMULATED", observationWindow: baselineWindow,
        fence: primaryFence(profile), maxGapSeconds: 3600,
        ...(baselineCohort.freight.length > 0 ? { entityIds: baselineCohort.freight } : {}),
      }).entries;

      // The detector watches metricType "dwell_cohort_size"; the dwell engine
      // labels its outputs "dwell_estimate" — relabel for the detector only
      // (formulaVersion stays dwell-estimate-v1; values unchanged).
      const dwellCurrentForDetector = { ...dwell.cohortSize, metricType: "dwell_cohort_size" as const };
      const dwellBaselineForDetector = { ...baselineDwell.cohortSize, metricType: "dwell_cohort_size" as const };

      const events = detectChokepointEvents(profile.id, [
        { current: dwellCurrentForDetector, baseline: dwellBaselineForDetector },
        { current: movingFractionMetric, baseline: baselineMoving },
        { current: entryExit.entries, baseline: baselineEntry },
      ], { detectedAt: computedAt });

      const vesselComparison = compareWithBaseline(vesselCountMetric, baselineVesselCount, { computedAt });
      const movingComparison = compareWithBaseline(movingFractionMetric, baselineMoving, { computedAt });
      const toView = (c: ReturnType<typeof compareWithBaseline>): BaselineComparisonView => ({
        relativeChange: c.relativeChange,
        absoluteChange: c.absoluteChange,
        direction: c.direction,
        qualityState: c.comparison.quality.state,
        note: c.comparison.quality.coverageNote,
      });

      return {
        profile,
        window,
        baselineWindow,
        observations: inFence,
        freightEntityIds: cohort.freight,
        unclassifiedCount: cohort.unclassified.length,
        otherCount: cohort.other.length,
        metrics: {
          vesselCount: vesselCountMetric,
          movingFraction: movingFractionMetric,
          dwellCohortSize: dwell.cohortSize,
          dwellMedianSeconds: dwell.medianDwellSeconds,
          entryCount: entryExit.entries,
          exitCount: entryExit.exits,
        },
        comparisons: {
          vesselCount: toView(vesselComparison),
          movingFraction: toView(movingComparison),
        },
        events,
        provenance: fixtureAdapter.getProvenancePerProvider(),
        attribution: fixtureAdapter.getAttribution(),
        sourceMode: options.mode,
        health: { fixture: fixtureAdapter.getStatus(), live: liveAdapter ? liveAdapter.getStatus() : null },
      };
    },
    destroy: () => {
      fixtureAdapter.destroy();
      liveAdapter?.destroy();
    },
  };
  return manager;
}

