/**
 * Data module boundary (CHOKEPOINT-PLAN.md §9.2, src/data/).
 *
 * Phase 1 (in progress): canonical observation model, truth states, and the
 * SIMULATED-labeled fixture loader. Source adapters, provenance records, and
 * the source health state machine are remaining Phase 1 deliverables.
 */

export * from "./truthState";
export * from "./observation";
export * from "./fixtureLoader";
