# Chokepoint Detector Evaluation Report (v1)

- Generated: 2026-09-09T18:11:07.479Z
- Evaluation clock (deterministic): 2026-09-09T16:00:00Z
- Command: `npm run eval`
- Scope: long-beach-approach (geofence:outer-anchorage@2026-09-09-v1)
- Detector: event-detector-v1 | Metrics: detector-metrics-v1

## Dataset (§12.6 manifest)

All inputs are SIMULATED fixtures; no real AIS data is used.
- `classification-change.json` — classification-change (4 observations)
- `conflicting-sources.json` — conflicting-sources (2 observations)
- `duplicates.json` — duplicates (8 observations)
- `malformed-inputs.json` — malformed-inputs (8 observations)
- `missing-intervals.json` — missing-intervals (4 observations)
- `normal-transit.json` — normal-transit (5 observations)
- `out-of-order.json` — out-of-order (5 observations)
- `port-entry-exit.json` — port-entry-exit (6 observations)
- `source-outage.json` — source-outage (3 observations)
- `stale-cache-fallback.json` — stale-cache-fallback (3 observations)
- `stationary-anchorage.json` — stationary-anchorage (5 observations)

## §12.3 Metrics

| Metric | Value |
|---|---|
| True positives | 3 |
| False positives | 0 |
| False negatives | 1 |
| Precision | 100.0% |
| Recall | 75.0% |
| F1 | 0.857 |
| FP per entity-hour | 0 (60 entity-hours) |
| Mean detection latency | 1600s |

## Detected events

- **queue_buildup**: 10 → 30 (200%)
- **stoppage**: 0.9 → 0.5 (-44%)
- **flow_surge**: 2 → 8 (300%)

## Known failures (§12.6 — documented, not hidden)

- **KNOWN-1** (false_negative): A real queue buildup with a single-observation baseline does NOT fire. The detector refuses LOW_SAMPLE comparisons (§3.3); the labeled truth records the event, so it counts as a false negative. This is deliberate: claiming an event from a 1-observation baseline would violate the trust contract.
- **KNOWN-2** (geometry_limitation): The Malacca/Singapore strait-traffic-corridor fence is all-approximate (±0.05°, not digitized from IMO Ships' Routeing); entry/exit and vessel counts in that fence carry that geometric uncertainty until a v2 re-derivation (ADR-0011).

## Interpretation limits

- Thresholds are starter demo values; §12.3 calibration against known historical
  conditions is the documented path to tuning.
- Recall is capped by the LOW_SAMPLE refusal (scenario E): raising recall by
  firing on 1-observation baselines would violate the §3.3 trust contract.
- This report predates any live data; live-source evaluation repeats this
  command after the AISStream adapter lands.

