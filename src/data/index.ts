/**
 * Data module boundary (CHOKEPOINT-PLAN.md §9.2, src/data/).
 *
 * Phase 1: canonical observation model, truth states, fixture loader, source
 * health state machine, source adapter contract, provenance records, and the
 * fixture-mode adapter. No live adapter exists (all §6.1 terms decisions TBD).
 */

export * from "./truthState";
export * from "./observation";
export * from "./fixtureLoader";
export * from "./sourceHealth";
export * from "./sourceAdapter";
export * from "./provenance";
export * from "./fixtureAdapter";
export * from "./geofences";
export * from "./ais";
