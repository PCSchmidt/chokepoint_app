# Phase 6 — Public Beta Decision (2026-09-10)

CHOKEPOINT-PLAN.md §17 Phase 6 asks six questions, then a decision: purchase
additional data, deploy durable infrastructure, build the mobile companion —
or none of these yet. This memo evaluates each question against measured
evidence in the repository and recommends an action.

## Standing of the product at evaluation time

- Commits: 43, first commit 2026-09-09 (a two-day build). 276 deterministic
  tests, CI green on main.
- Phases 0–5 exit criteria met: fixture-mode app with reviewed geofences,
  verified agent (19/19 groundedness scenarios), PWA offline shell, Docker
  stack with Prometheus (target `up = 1`) and Grafana, security review 10
  PASS, clean-machine quick start.
- `docs/case-study.md` holds the measured-results summary.

## The six questions

### 1. Do users understand the product without explanation?

**Cannot be answered yet — no user contact.** The §21 definition-of-done item
"a new user can open the application and understand its purpose within
seconds" requires observation of real first-use. The launcher design (cards
with honest coverage states, SIM badge always visible) is *built for* that
test, and the §9.3 badge vocabulary is self-describing, but this is a
hypothesis until observed.

### 2. Do they trust the evidence drawer?

**Instrumented, unproven.** The drawer exposes metrics + formulas +
comparisons + provenance + limitations with no causal text (tested), and the
agent answer surface renders rejected-claim transparency. Trust is measurable
once users arrive (§12.4 "human-rated usefulness and clarity"), not before.

### 3. Which chokepoints generate repeat interest?

**Requires usage data.** Three profiles exist; Suez honestly renders
coverage-UNKNOWN. There is no telemetry on which chokepoints draw attention —
and deliberately so: §13.1 forbids unbounded user identifiers in metrics. Any
beta would need an explicit, privacy-respecting product-analytics decision
first.

### 4. Are alerts more valuable than exploration?

**Partially answerable by design, unproven with users.** The watchlist
(Workflow E) exists in local-first form: threshold + freshness policy,
deterministic evaluation, no external notifications. The §2.2 Workflow D
(alert-style comparison) is tested at the data layer. Whether alerts beat
exploration as a habit is a beta-measurement question.

### 5. Are source costs and licenses sustainable?

**Yes at current scale; the risk is documented, not eliminated.** AISStream is
admitted as a documented risk acceptance (it publishes no data-use terms —
ADR-0010). Paid alternatives (Datalastic, MarineTraffic) were assessed and
deferred. Fixture mode — the entire current product surface — costs nothing
and has no terms exposure. A public beta with live data would need: a hosted
key proxy (§10.2), the §6.1 admission gate re-run per source, and a
buffer/traffic estimate. Sustainability is therefore a *live-mode* decision,
not a fixture-mode blocker.

### 6. Is the product useful enough to justify accounts and persistence?

**Not yet demonstrable.** Share links already carry full investigation state
(§11.2, tested), which may satisfy sharing without accounts. §11.3 features
(accounts, saved investigations, team spaces) are explicitly gated on user
validation that has not occurred.

## Decision

**Hold: run a limited beta before any spend or infrastructure.**

Rationale against each permitted action:

1. **Purchase additional data** — not yet. The §1.3 portfolio thesis
   (deterministic metrics before generative AI; evaluation before LLM) is
   demonstrated fully in fixture mode. Buying data before observing how
   anyone uses the fixture product risks paying to accelerate a workflow
   nobody has validated. The AISStream live path works locally (`npm run
   smoke` evidence, 571 records) — a live-data beta can be staged cheaply
   behind a hosted proxy *after* first usage signals exist.
2. **Deploy durable infrastructure** — not yet. The local Docker stack meets
   §16.1 and the security review notes exactly what a public deployment adds
   (rate limiting, non-root container, hosted key proxy, §16.2 review). Those
   are scheduled engineering tasks with known scope, best done once the beta
   question in §1 ("do users understand it?") has data behind it.
3. **Build the mobile companion** — not yet. Decision 5 already sequences PWA
   before native; the PWA install/offline path is done and is the cheapest
   mobile-accessible surface. A native companion is premature before the
   alert-vs-exploration question (§17 Q4) has an answer.

## What would change this decision (triggers)

- 5–10 observed first-use sessions where users reach an investigation without
  help → revisit deployment (a small hosted demo, still fixture-mode).
- A concrete request/validation for live-data value → stage the AISStream key
  proxy (§10.2) with quotas (§10.4) and a §6.1 re-review.
- A user cohort that returns for watchlist-style alerts → prioritize the
  hosted scheduled evaluation job (§11.3) before native mobile.

## Beta status update (2026-09-10, post-implementation)

- The static fixture-mode build is PUBLISHED:
  https://pcschmidt.github.io/chokepoint_app/ (CI-deployed on every main push).
- The launcher now includes the two multimodal candidate profiles (air, land)
  with honest placeholder/UNKNOWN states.
- Beta observation channel: a plain "Feedback" link to GitHub Discussions in
  the attribution bar — privacy-safe by construction (no tracking, no
  identifiers, §13.1/§14.3).
- The multimodal admission gate + fixture-first implementation completed after
  this memo was written (ADRs 0012–0015; see STATUS.md). The "publish the
  static build" recommendation is DONE; Q1–Q3 observation starts with the
  first external visitors.

## Recommended immediate next step

The repository-side work for a public demo is complete. The cheapest
next experiment is **publishing the static fixture-mode build** (Pages or any
static host) and watching §17 Q1–Q3 with a small cohort — no accounts, no
persistence, no data purchase. The `SIM` badge and UNKNOWN states make this
honest by construction.
