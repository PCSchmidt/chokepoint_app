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

## 2a. Facility-level metric model (ADR-0015)

Facility signals (border wait times now; rail crossings if ever) are a
SEPARATE canonical record — never merged into `TransportObservation` totals,
cohorts, or geofence counts:

```ts
interface FacilityMetric {
  metricId: string;
  facilityId: string;          // provider-scoped, e.g. "cbp:240201:bridge"
  facilityType: "border-crossing" | "rail-crossing" | "airport-cargo" | "port-terminal";
  displayName: string;
  mode: "land" | "rail" | "air";
  location: { latitude: number; longitude: number } | null;
  observedAt: string;          // the provider's own reading timestamp
  receivedAt: string;
  measurements: {
    laneGroup: "commercial_vehicle" | "passenger_vehicle" | "pedestrian" | "fast" | "nexus_sentri" | "ready";
    metric: "wait_minutes" | "lanes_open" | "operational_status";
    value: number | null;      // null = UNKNOWN, never zero (§3.3)
    unit: "minutes" | "lanes" | "status";
    statusLabel?: string;      // verbatim provider wording ("no delay", "Update Pending")
  }[];
  providerUpdateLabel: string | null;  // verbatim ("At 8:00 am MDT")
  portStatus: string | null;
  source: { providerId; endpointId; recordRef?; licenseId };
  quality: { sourceState: "fresh" | "stale" | "degraded" | "unavailable" };
}
```

Invariants (same §3.3 discipline as §2): negative wait times and non-numeric
values are rejected, never clamped; missing readings are omitted (absent ≠
zero); dedupe keys on (facilityId, observedAt, lane/metric set) with the
latest `receivedAt` winning deterministically; `wait_minutes` is an OBSERVED
value reported by CBP, never a derived metric; the verbatim lane update label
and port status are displayed, not parsed into truth states. Source:
`src/data/facilityMetric.ts`; fixture: `tests/fixtures/cbp-border-wait-el-paso.json`.

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

Current status (2026-09-10): nine reviewed geofences exist in
`src/config/chokepoints.ts` — six maritime fences approved 2026-09-09
(ADR-0011, geometry `2026-09-09-v1`) and three multimodal fences approved
2026-09-10 (`el-paso-v1-2026-09-10`, `lax-v1-2026-09-10`): the LAX
cargo-aircraft observation region and two El Paso crossing frames. The El Paso
frames are DISPLAY FRAMING ONLY: facility metrics key on `facilityId` and are
never geofence-membership computations (ADR-0013/0015). Review owner:
ChrisSchmidt (GitHub: PCSchmidt); candidate provenance per vertex lives in
`research/geofence-candidates.md`.

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

The evidence builder, claim evaluator, and generator ARE IMPLEMENTED
(`src/agent/`, claim-evaluator-v1): typed intents over the §4.4 tool
allowlist, deterministic snapshot-only tools, content-addressed evidence
bundles, evaluator-gated answers (§8.3–8.5), and a text query surface.
Groundedness: 25/25 labeled scenarios (`npm run eval:agent`). A deterministic
voice path (browser Web Speech) renders the same evaluator-gated answers;
transcripts are never persisted (§11.2). Facility-level signals carry their
own contract (see §2a below, ADR-0015).

## 7. Source adapter contract (§5.1)

Each source module implements the lifecycle contract from §5.1 (`enable`,
`disable`, `refresh`, `getStatus`, `getRecords`, `getAttribution`, `destroy`)
and owns provider request details, validation, normalization, retry/cache
policy, health, and attribution. It must not own UI layout, AI prompting, or
camera state. The adapter interface and source health state machine are Phase 1
deliverables; no live adapter exists yet.
