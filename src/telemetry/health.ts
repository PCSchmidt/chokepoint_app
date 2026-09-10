/**
 * Health and readiness (CHOKEPOINT-PLAN.md §10.3, §16.1, §9.2
 * src/telemetry).
 *
 * Clear separation (§16.1 "clear health and readiness endpoints"):
 *  - LIVENESS (/api/health): the process is up. No data checks — a process
 *    waiting for data is alive, not ready.
 *  - READINESS (/api/ready): the app can serve investigations. Computed
 *    from the data manager: profiles registered, default window resolvable,
 *    per-source health states reported HONESTLY (§3.1) — a missing live key
 *    is UNAVAILABLE, never an error and never hidden.
 *
 * Both payloads use the stable §10.3 envelope. Timestamps are injected, so
 * the functions are deterministic and testable — the wall clock is read at
 * the server boundary only.
 */

import type { DataManager } from "../data/manager";

export const HEALTH_VERSION = "health-v1";

/** §10.3 stable response envelope. */
export interface ApiEnvelope<T> {
  status: "ok" | "degraded" | "error";
  data: T;
  quality: {
    state: string;
    observedAt: string | null;
    coverage: string;
  };
  provenance: Array<Record<string, unknown>>;
  errors: string[];
}

export interface HealthData {
  service: "chokepoint";
  liveness: "alive";
  mode: "fixture" | "live";
  uptimeSeconds: number;
  versions: { health: string };
}

export interface ReadinessSourceReport {
  sourceId: string;
  state: string;
  lastRefreshAt: string | null;
  lastObservationAt: string | null;
  ageSeconds: number | null;
  detail: string | null;
}

export interface ReadinessData {
  service: "chokepoint";
  ready: boolean;
  mode: "fixture" | "live";
  liveAvailable: boolean;
  chokepointCount: number;
  chokepointIds: string[];
  sources: ReadinessSourceReport[];
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export function buildHealth(mode: "fixture" | "live", startedAtMs: number, nowMs: number): ApiEnvelope<HealthData> {
  return {
    status: "ok",
    data: {
      service: "chokepoint",
      liveness: "alive",
      mode,
      uptimeSeconds: Math.max(0, Math.round((nowMs - startedAtMs) / 1000)),
      versions: { health: HEALTH_VERSION },
    },
    quality: { state: "fresh", observedAt: null, coverage: "process-local" },
    provenance: [],
    errors: [],
  };
}

/**
 * Readiness from the manager: fixture layer must expose profiles and a
 * default window; the live layer is reported as its honest state (a missing
 * key makes live UNAVAILABLE without failing readiness — fixture mode is the
 * no-credentials path, §16.1).
 */
export function buildReadiness(manager: DataManager): ApiEnvelope<ReadinessData> {
  const errors: string[] = [];
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const profiles = manager.listChokepoints();
  checks.push({
    name: "profiles-registered",
    ok: profiles.length > 0,
    detail: `${profiles.length} chokepoint profile(s) registered`,
  });

  let defaultWindow: { startAt: string; endAt: string } | null = null;
  try {
    defaultWindow = manager.defaultWindow();
    checks.push({
      name: "default-window-resolvable",
      ok: true,
      detail: `${defaultWindow.startAt} -> ${defaultWindow.endAt}`,
    });
  } catch (err) {
    checks.push({ name: "default-window-resolvable", ok: false, detail: String(err).slice(0, 120) });
    errors.push("default window unavailable");
  }

  // Per-source health, honest states (§3.1): probe one snapshot per profile.
  const sources: ReadinessSourceReport[] = [];
  for (const profile of profiles) {
    try {
      const window = defaultWindow ?? manager.defaultWindow();
      const snap = manager.getSnapshot(profile.id, window);
      sources.push({
        sourceId: `fixture:${profile.id}`,
        state: snap.health.fixture.state,
        lastRefreshAt: snap.health.fixture.lastRefreshAt ?? null,
        lastObservationAt: snap.health.fixture.lastObservationAt ?? null,
        ageSeconds: snap.health.fixture.ageSeconds ?? null,
        detail: snap.health.fixture.detail ?? null,
      });
    } catch (err) {
      errors.push(`snapshot failed for ${profile.id}: ${String(err).slice(0, 120)}`);
      sources.push({
        sourceId: `fixture:${profile.id}`,
        state: "UNAVAILABLE",
        lastRefreshAt: null,
        lastObservationAt: null,
        ageSeconds: null,
        detail: `snapshot failed: ${String(err).slice(0, 100)}`,
      });
    }
  }
  if (manager.liveAvailable) {
    checks.push({ name: "live-layer", ok: true, detail: "live adapter available" });
  } else {
    // NOT an error: fixture mode is the keyless path (§6.2). Reported, not
    // hidden, and not blocking readiness.
    checks.push({ name: "live-layer", ok: true, detail: "live layer unavailable (no key) — fixture mode serves" });
  }

  const ready = checks.every((c) => c.ok) && profiles.length > 0;
  const degradedStates = sources.filter((s) => s.state !== "FRESH").map((s) => s.state);
  return {
    status: ready ? (degradedStates.length > 0 ? "degraded" : "ok") : "error",
    data: {
      service: "chokepoint",
      ready,
      mode: manager.mode,
      liveAvailable: manager.liveAvailable,
      chokepointCount: profiles.length,
      chokepointIds: profiles.map((p) => p.id),
      sources,
      checks: checks.map(({ name, ok, detail }) => ({ name, ok, detail })),
    },
    quality: {
      state: degradedStates.length === 0 ? "fresh" : "degraded",
      observedAt: null,
      coverage: "data-manager",
    },
    provenance: [],
    errors,
  };
}
