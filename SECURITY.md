# SECURITY.md — Security, Privacy, and Responsible Use

Source of truth: `CHOKEPOINT-PLAN.md` §14.

## 1. Secret handling (§14.1)

- Private provider keys remain server-side. They are never shipped to the
  browser.
- Browser-visible map tokens are restricted by origin and API scope.
- `.env` files are gitignored; `.env.example` documents variable names only,
  never values.
- No credentials in share URLs, logs, screenshots, or fixtures.
- Hosted deployments require provider-side spend limits in addition to
  application throttles.

Phase 0/1 status: the application reads no secrets at all. Fixture mode
requires zero credentials (§6.2, §16.1).

## 2. Proxy security (§14.2)

All external calls (when live sources are admitted in later phases) require:

- Fixed upstream host allowlists — no arbitrary upstream URLs from clients.
- SSRF protections for any user-influenced destination.
- Request timeout and response-size caps.
- Schema validation before persistence.
- Sanitized client errors.
- Per-client and global rate limits.
- Request body limits.
- Cache poisoning protections.
- In-flight request deduplication.
- Bounded memory/disk cache with a stale fallback policy that preserves the
  original observation timestamp plus a separate cache age (§3.3, §10.4).

## 3. Privacy boundary (§14.3)

The application operates on transportation entities and aggregate movement
patterns, not people. Do not add:

- Named-person tracking.
- Facial recognition.
- Driver identification.
- Personal travel profiling.
- Sensitive location inference.

Where provider identifiers are retained, minimize retention and document why
they are necessary.

## 4. Responsible use (§14.4)

The product never claims intent, cause, or threat from movement data alone.
See `AGENTS.md` §6 for the approved/forbidden language lists, and §1.2 of the
plan for the product non-promises.
