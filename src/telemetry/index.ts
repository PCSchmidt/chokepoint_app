/**
 * Telemetry module boundary (CHOKEPOINT-PLAN.md §9.2, §13): health/readiness
 * (§16.1), Prometheus metrics (§13.1), structured logs (§13.3).
 */

export * from "./health";
export * from "./metrics";
export * from "./logger";