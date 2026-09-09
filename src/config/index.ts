/**
 * Configuration module boundary (CHOKEPOINT-PLAN.md §9.2, §4.3).
 *
 * Configuration must be data-driven and reviewed, never scattered through
 * conditionals. Chokepoint profiles live in chokepoints.ts; the source
 * registry lives in sourceRegistry.ts.
 */

export * from "./chokepoints";
export * from "./sourceRegistry";
