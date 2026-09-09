# CONTRACT.md — Canonical Data Contracts

Source of truth: `CHOKEPOINT-PLAN.md` §5.2–§5.6. The TypeScript definitions in
`src/data/` implement these contracts; this document is the human-readable
reference. Where code and this document disagree, the plan governs and the code
is fixed.

## 1. Truth-state vocabulary (§3.1)

Every observation, metric, event, and generated answer carries one of:

| State | Meaning |
|---|---|
| `OBSERVED` | Directly reported or decoded from a provider. |
| `DERIVED` | Calculated from observed records using a documented formula. |
| `SIMULATED` | Generated for demonstration or fallback; explicitly badged, never mixed into observed totals. |
| `UNKNOWN` | Insufficient, stale, contradictory, or unavailable evidence. |

Orthogonal health states: `FRESH`, `STALE`, `DEGRADED`, `UNAVAILABLE`,
`NEVER_ANSWERED`. `DERIVED + DEGRADED` is a valid combination and must not be
silently downgraded.

## 2. Canonical observation model (§5.2)

```ts
interface TransportObservation {
  observationId: string;
  entityId: string;
  mode: "sea" | "air" | "land" | "rail";
  entityType: "cargo_vessel" | "tanker" | "bulk_carrier" | "aircraft" | "vehicle" | "unknown";
  position: {
    latitude: number;
    longitude: number;
    altitudeMeters?: number;
  };
  kinematics: {
    speedKnots?: number;
    speedKph?: number;
    headingDegrees?: number;
  };
  observedAt: string;
  receivedAt: string;
  source: {
    providerId: string;
    endpointId: string;
    recordRef?: string;
    licenseId: string;
  };
  quality: {
    sourceState: "fresh" | "stale" | "degraded" | "unavailable";
    positionAccuracy?: "exact" | "approximate" | "unknown";
    classification: "confirmed" | "inferred" | "unknown";
  };
}
```

Invariants enforced at ingestion (Phase 1 tests, §12.1):

- Provider timestamps (`observedAt`) are never replaced with request receipt
  time (`receivedAt`) — §3.3.
- Latitude must be within [-90, 90] and longitude within [-180, 180]; invalid
  coordinates are rejected, never clamped.
- Duplicate records (same provider `recordRef` / same entity + timestamp) are
  deduplicated deterministically; the winner is stable.
- Records may arrive out of order; normalized collections are ordered by
  `observedAt` and ordering is a testable property.
- Entity identity is stable: the same entity observed across records, sessions,
  and providers resolves to the same `entityId` (see `entityKey` in
  `src/data/observation.ts`).
- A vessel without reliable classification is `entityType: "unknown"` and is
  excluded from type-specific totals (§3.3).

## 3. Track model (§5.3)

Track construction preserves raw observations and derived interpolation
separately. Interpolated positions are never represented as if directly
observed.

```ts
interface TrackSegment {
  trackId: string;
  entityId: string;
  observations: string[];
  startAt: string;
  endAt: string;
  interpolation: {
    method: "none" | "linear" | "kinematic";
    maxGapSeconds: number;
  };
  quality: {
    observedPointCount: number;
    interpolatedPointCount: number;
    largestGapSeconds: number;
    sourceState: string;
  };
}
```

Implementation status: interface defined (Phase 2 deliverable); segmentation,
crossing detection, and dwell calculation are deferred to Phase 2 (§17).

## 4. Geofences (§5.4)

Geospatial definitions are versioned records with:

- Stable identifier.
- Human-readable purpose.
- Geometry version.
- Coordinate reference assumptions.
- Inclusion/exclusion rules.
- Effective date.
- Review owner.
- Source or rationale.

Current status: the three MVP chokepoint profiles exist in
`src/config/chokepoints.ts` with **placeholder geometry flagged
`geometryStatus: "placeholder"`**. Real reviewed geofence coordinates are an
open item; placeholder geofences must never be used for membership decisions.

## 5. Derived metric model (§5.5)

```ts
interface DerivedMetric {
  metricId: string;
  metricType: string;
  scope: QueryScope;
  value: number | null;
  unit: string;
  computedAt: string;
  observationWindow: {
    startAt: string;
    endAt: string;
  };
  formulaVersion: string;
  inputs: string[];
  quality: {
    state: "fresh" | "stale" | "degraded" | "unknown";
    sampleCount: number;
    coverageNote: string;
    confidence?: number;
  };
}
```

Metric implementations (vessel count, moving fraction, entry/exit counts, dwell
estimate — §7) are Phase 2 deliverables and are not implemented yet.

## 6. Evidence bundle (§5.6)

The evidence bundle is the contract between deterministic analytics and
generative explanation (§8). Structure per §5.6: `bundleId`, `createdAt`,
`question` (raw text, normalized intent, scope), `observations`, `metrics`,
`events`, `sourceHealth`, `claimsAllowed`, `claimsRejected`, and `versions`
(schema, metric, detector, evaluator).

The evidence builder, claim evaluator, and generator are Phase 4 deliverables
and are deliberately not implemented in Phase 0/1.

## 7. Source adapter contract (§5.1)

Each source module implements the lifecycle contract from §5.1 (`enable`,
`disable`, `refresh`, `getStatus`, `getRecords`, `getAttribution`, `destroy`)
and owns provider request details, validation, normalization, retry/cache
policy, health, and attribution. It must not own UI layout, AI prompting, or
camera state. The adapter interface and source health state machine are Phase 1
deliverables; no live adapter exists yet.
