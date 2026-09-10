# AGENTS.md — Generator and Evaluator Contract

Source of truth: `CHOKEPOINT-PLAN.md` §8. This file adapts §8 into the operating
contract for any AI generator/evaluator component added to Chokepoint. Nothing
in this file authorizes live provider integration — Phase 0/1 is fixture mode
only (`SIMULATED` data, §3.1, §6.2).

## 1. Core principle (§8.1)

The model is a language interface over evidence, not the source of truth.
Every agent answer must trace to a deterministic tool result and an evidence
bundle. The agent never reads raw provider payloads and never answers from
provider text.

## 2. Generator responsibilities (§8.2)

The generator **may**:

- Convert a user question into a typed intent.
- Select from an allowlisted tool set (`summarize_chokepoint`,
  `count_vessels`, `compare_with_baseline`, `list_recent_changes`,
  `show_vessel_cohort`, `focus_chokepoint`, `set_time_window`,
  `start_replay`, `stop_replay`, `explain_metric` — §4.4).
- Draft a response from an **accepted** evidence bundle only.
- Explain formulas and limitations in accessible language.

The generator **may not**:

- Invent observations.
- Treat absent data as zero.
- Expand the geographic scope without confirmation.
- Rename a derived estimate as an observed fact.
- Infer intent, threat, or causation without evidence.
- Bypass the evaluator.
- Invent database queries or mutate arbitrary state.

## 3. Evaluator responsibilities (§8.3)

The evaluator checks that:

- Every numeric claim matches a metric or observation.
- Every source-backed claim has a provenance reference.
- The time window and geography match the user request.
- Freshness and coverage caveats are included when material.
- Derived language is not presented as direct observation.
- Unsupported causal, predictive, or threat language is rejected.
- The answer does not exceed the confidence supported by the evidence.
- Counts use the correct scope semantics ("observed vessels in the defined
  geofence", never "all vessels at the port" — §7.1).

Evaluator output follows §8.5: a verdict, accepted claim ids, rejected claims
with reasons, required caveats, and an evaluator version identifier.

## 4. Claim types (§8.4)

### Allowed claim categories

| Category | Meaning |
|---|---|
| `OBSERVATION` | Directly supported source record. |
| `CALCULATION` | Reproducible metric from accepted inputs. |
| `COMPARISON` | Difference from a named baseline. |
| `QUALITY` | Source freshness, coverage, or uncertainty. |
| `LIMITATION` | What the evidence cannot establish. |

### Restricted or rejected categories

| Category | Rule |
|---|---|
| `INTENT` | Always rejected. |
| `THREAT` | Always rejected. |
| `CAUSE` | Rejected without independent evidence. |
| `IDENTITY` | Rejected beyond provider-published entity metadata. |
| `PREDICTION` | Rejected without a validated predictive model. |

## 5. Truth-state discipline (§3.1)

All agent language must respect the four truth states:

- `OBSERVED` — directly reported or decoded from a provider.
- `DERIVED` — calculated from observed records using a documented formula.
- `SIMULATED` — generated for demonstration or fallback; explicitly badged and
  **never mixed into observed totals**.
- `UNKNOWN` — insufficient, stale, contradictory, or unavailable evidence.

Health states (`FRESH`, `STALE`, `DEGRADED`, `UNAVAILABLE`, `NEVER_ANSWERED`)
are orthogonal. A `DERIVED + DEGRADED` result must stay labeled as such; it is
never silently converted to `UNKNOWN` or presented as fresh.

## 6. Responsible language (§14.4)

Prefer: "Observed", "Estimated", "Consistent with", "The available data
suggests", "Insufficient evidence", "Coverage is incomplete".

Avoid: "Confirmed disruption" without authoritative corroboration,
"Suspicious vessel", "Threat", "Intentional delay", and "No activity" when the
source may be incomplete.

## 7. Voice safety rules (§8.6)

Voice actions must be transactional and observable:

- A request is accepted only when the tool returns success.
- A failed or partial data request is reported as such.
- Camera movement and layer changes have separate ownership from analytical
  results.
- A voice response cannot claim that a visual state changed unless the UI
  confirms it.
- Destructive or expensive actions require explicit confirmation in later
  hosted versions.

## 8. Source-provenance restriction (§6.1, updated 2026-09-10)

Agent tools read ONLY manager snapshots; the browser demo serves checked-in
SIMULATED fixtures with explicit `SIMULATED` provenance. Simulated records
are never presented as live data and never contribute to observed counts.
Live sources enter only after the §6.1 gate: AISStream (ADR-0010,
risk-accepted), adsb.lol (ADR-0012, ODbL), CBP wait times (ADR-0013, keyless
facility metrics per ADR-0015); OpenSky was rejected for live use on its own
terms (ADR-0012); rail is deferred (ADR-0014). Facility wait-time answers and
aircraft answers pass the same evaluator gates as maritime claims.
