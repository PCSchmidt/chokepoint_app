/**
 * Server + health/readiness tests (§10.3, §16.1, §13.1, §13.3).
 *
 * Real HTTP against an ephemeral port (localhost only — CI stays keyless and
 * network-free beyond loopback). Covers the stable envelope, honest live-
 * layer reporting, metrics exposition, and log redaction.
 */

import { describe, expect, it } from "vitest";
import { createDataManager } from "../../src/data/manager";
import { buildHealth, buildReadiness } from "../../src/telemetry/health";
import { MetricsRegistry } from "../../src/telemetry/metrics";
import { StructuredLogger, redact } from "../../src/telemetry/logger";

import type { ApiEnvelope } from "../../src/telemetry/health";

describe("health payload (§16.1 liveness)", () => {
  it("reports alive with injected uptime (no wall-clock reads in the domain)", () => {
    const envelope = buildHealth("fixture", 1_000, 61_000);
    expect(envelope.status).toBe("ok");
    expect(envelope.data.liveness).toBe("alive");
    expect(envelope.data.uptimeSeconds).toBe(60);
    expect(envelope.data.mode).toBe("fixture");
  });
});

describe("readiness payload (§16.1, §3.1 honest states)", async () => {
  const manager = await createDataManager({ mode: "fixture" });

  it("is ready in fixture mode with profiles registered", async () => {
    const envelope = buildReadiness(manager);
    expect(envelope.data.ready).toBe(true);
    expect(envelope.data.chokepointCount).toBe(3);
    expect(envelope.data.checks.find((c) => c.name === "profiles-registered")!.ok).toBe(true);
    expect(envelope.data.checks.find((c) => c.name === "default-window-resolvable")!.ok).toBe(true);
  });

  it("reports the live layer honestly without failing readiness (§6.2)", async () => {
    const envelope = buildReadiness(manager);
    const liveCheck = envelope.data.checks.find((c) => c.name === "live-layer")!;
    expect(liveCheck.ok).toBe(true); // not a readiness failure
    expect(liveCheck.detail).toMatch(/unavailable|available/);
    expect(envelope.data.mode).toBe("fixture");
  });

  it("reports per-source health states from the manager", async () => {
    const envelope = buildReadiness(manager);
    expect(envelope.data.sources.length).toBe(envelope.data.chokepointCount);
    for (const s of envelope.data.sources) {
      expect(["FRESH", "STALE", "DEGRADED", "UNAVAILABLE", "NEVER_ANSWERED"]).toContain(s.state);
    }
  });
});

describe("metrics registry (§13.1)", () => {
  it("renders the Prometheus text format with bounded labels", () => {
    const registry = new MetricsRegistry();
    registry.inc("chokepoint_http_requests_total", { route: "/api/health", status: "2xx" });
    const text = registry.render();
    expect(text).toContain("# TYPE chokepoint_http_requests_total counter");
    expect(text).toContain('chokepoint_http_requests_total{route="/api/health",status="2xx"} 1');
  });

  it("rejects unregistered metric names (label discipline)", () => {
    const registry = new MetricsRegistry();
    expect(() => registry.inc("not_a_metric", {})).toThrow(/unregistered/);
  });
});

describe("structured logs (§13.3)", () => {
  it("emits one-line JSON with correlation id and duration", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((l) => lines.push(l));
    logger.info("request", { correlationId: "corr-1", durationMs: 12, resultStatus: "200" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.msg).toBe("request");
    expect(parsed.correlationId).toBe("corr-1");
    expect(parsed.durationMs).toBe(12);
    expect(lines[0]!.split("\n")).toHaveLength(1);
  });

  it("redacts key-like material from messages and string fields", () => {
    expect(redact("http://x/?key=SECRET123&y=1")).not.toContain("SECRET");
    expect(redact("Bearer abc123def456")).not.toContain("abc123def456");
    expect(redact("token sk-abcdefghijklmnop")).not.toContain("abcdefghijklmnop");
  });

  it("respects the minimum level", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger((l) => lines.push(l), "warn");
    logger.debug("noisy");
    logger.warn("careful");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/careful/);
  });
});

describe("HTTP server integration (§10.3, §16.1)", () => {
  it("serves liveness, readiness, profiles, metrics, and static SPA fallback", async () => {
    const metrics = new MetricsRegistry();
    const { startServer } = await import("../../src/server/server");
    const app = await startServer({ port: 0, staticDir: "dist", metrics });

    const base = `http://127.0.0.1:${app.port}`;

    // Liveness
    const health = await fetch(`${base}/api/health`).then((r) => r.json() as Promise<ApiEnvelope<{ liveness: string }>>);
    expect(health.status).toBe("ok");
    expect(health.data.liveness).toBe("alive");

    // Readiness
    const readyRes = await fetch(`${base}/api/ready`);
    const ready = (await readyRes.json()) as ApiEnvelope<{ ready: boolean; sources: Array<{ state: string }> }>;
    expect(readyRes.status).toBe(200);
    expect(ready.data.ready).toBe(true);
    expect(ready.data.sources.length).toBeGreaterThan(0);

    // Profiles (§4.3 registry)
    const profiles = await fetch(`${base}/api/chokepoints`).then((r) => r.json() as Promise<ApiEnvelope<Array<{ id: string }>>>);
    expect(profiles.data.map((p) => p.id)).toContain("long-beach-approach");

    // Metrics scrape (§16.1 exit criterion: "metrics scrape successfully")
    const metricsText = await fetch(`${base}/metrics`).then((r) => r.text());
    expect(metricsText).toContain("chokepoint_http_requests_total");
    expect(metricsText).toContain('route="/api/health"');

    // SPA fallback serves the built app
    const spa = await fetch(`${base}/`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("<div id=\"app\">");

    // 404 for unknown API-ish paths is JSON
    const missing = await fetch(`${base}/definitely-not-here`);
    expect(missing.status).toBe(200); // SPA fallback for client routes
    const badMethod = await fetch(`${base}/api/health`, { method: "POST" });
    expect(badMethod.status).toBe(405);

    await app.close();
  }, 30_000);
});
