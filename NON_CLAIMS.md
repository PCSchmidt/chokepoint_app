# NON_CLAIMS.md — What Chokepoint Does Not Claim

This is user-facing copy. It states plainly what the product does not know and
will not say. Source of truth: `CHOKEPOINT-PLAN.md` §1.2 and §14.4.

## The product does not claim to know

- **Intent.** Chokepoint does not claim to know the intent of any vessel,
  aircraft, driver, company, or person.
- **Cause.** It does not claim a delay has a particular cause unless an
  independent source supports that claim.
- **Completeness.** It does not claim to show the complete state of global
  freight movement. AIS coverage is incomplete; a vessel not visible to a
  source is not a vessel that does not exist.
- **Absence.** Missing public data does not prove that no activity exists.
- **Authority.** A derived congestion or waiting estimate is not an official
  port, carrier, or government statistic.

## What the numbers actually mean

| Label shown | Meaning |
|---|---|
| `OBSERVED` | Directly reported or decoded from a provider, with source and timestamp. |
| `DERIVED` | Calculated from observed records by a documented, versioned formula. |
| `ESTIMATE` | A derived value with stated inclusion rules and limitations. |
| `SIM` / `SIMULATED` | Generated for demonstration. Never mixed into observed totals. |
| `STALE` | Real data, but older than the freshness threshold. |
| `DEGRADED` | Partial or reduced-quality data; the result carries a coverage note. |
| `UNKNOWN` | Insufficient, contradictory, or unavailable evidence. We say so. |

## Language commitment

The product prefers: "Observed", "Estimated", "Consistent with", "The available
data suggests", "Insufficient evidence", "Coverage is incomplete".

The product avoids: "Confirmed disruption" without authoritative corroboration,
"Suspicious vessel", "Threat", "Intentional delay", and "No activity" when the
source may be incomplete.

## Privacy

Chokepoint operates on transportation entities and aggregate movement patterns,
not people. It does not track named persons, identify drivers, or profile
personal travel. See `SECURITY.md` §3.
