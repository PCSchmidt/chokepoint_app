/**
 * Prometheus metrics (CHOKEPOINT-PLAN.md §13.1, §9.2 src/telemetry).
 *
 * A tiny, dependency-free registry rendering the Prometheus text exposition
 * format on GET /metrics. Counters and gauges only — the app needs no
 * histograms yet (latency summaries come from logged durations).
 *
 * LABEL DISCIPLINE (§13.1): labels are bounded enums. Never raw entity ids,
 * user text, or arbitrary coordinates — callers pass route templates and
 * bounded status/state words only, enforced by narrow union types.
 */

export const METRICS_VERSION = "metrics-v1";

/** Bounded label values (§13.1: labels must be bounded). */
export type RouteLabel =
  | "/api/health"
  | "/api/ready"
  | "/api/sources"
  | "/api/chokepoints"
  | "/api/attribution"
  | "/metrics"
  | "static"
  | "other";

export type StatusLabel = "2xx" | "4xx" | "5xx";

export interface CounterSpec {
  name: string;
  help: string;
  labels: readonly string[];
}

/** The §13.1 metrics the app actually populates in local-first mode. */
export const SPEC: readonly CounterSpec[] = [
  { name: "chokepoint_http_requests_total", help: "HTTP requests by route and status class", labels: ["route", "status"] },
  { name: "chokepoint_http_request_errors_total", help: "HTTP requests failed with 5xx", labels: ["route"] },
  { name: "chokepoint_metric_computations_total", help: "Snapshot metric computations", labels: ["result"] },
  { name: "chokepoint_evidence_bundles_total", help: "Evidence bundles built", labels: ["result"] },
  { name: "chokepoint_claims_accepted_total", help: "Claims accepted by the evaluator", labels: [] },
  { name: "chokepoint_claims_rejected_total", help: "Claims rejected by the evaluator", labels: ["category"] },
  { name: "chokepoint_agent_requests_total", help: "Agent turns by outcome", labels: ["outcome"] },
];

/** Bounded rejection categories (§8.4). */
export type RejectedCategory = "THREAT" | "CAUSE" | "PREDICTION" | "IDENTITY" | "INTENT" | "PROVENANCE" | "SCOPE" | "NUMERIC";

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();

  private key(name: string, labels: Readonly<Record<string, string>>): string {
    const spec = SPEC.find((s) => s.name === name);
    if (!spec) throw new Error(`unregistered metric: ${name}`);
    const parts = spec.labels.map((l) => {
      const v = labels[l];
      if (v === undefined) throw new Error(`metric ${name} missing label ${l}`);
      return `${l}="${escapeLabel(v)}"`;
    });
    return `${name}{${parts.join(",")}}`;
  }

  inc(name: string, labels: Record<string, string>, by = 1): void {
    const k = this.key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  /** Prometheus text exposition (version 0.0.4). Deterministic order. */
  render(): string {
    const lines: string[] = [];
    const groups = new Map<string, string[]>();
    for (const spec of SPEC) groups.set(spec.name, []);
    for (const [key, value] of [...this.counters.entries()].sort()) {
      const name = key.slice(0, key.indexOf("{"));
      groups.get(name)?.push(`${key} ${value}`);
    }
    for (const spec of SPEC) {
      lines.push(`# HELP ${spec.name} ${spec.help}`);
      lines.push(`# TYPE ${spec.name} counter`);
      const metricLines = groups.get(spec.name) ?? [];
      if (metricLines.length === 0 && spec.name === "chokepoint_http_requests_total") {
        // always expose the http counter shape even with no traffic yet
        metricLines.push(`chokepoint_http_requests_total{route="other",status="2xx"} 0`);
      }
      lines.push(...metricLines);
    }
    return `${lines.join("\n")}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
