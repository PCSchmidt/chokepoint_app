# Security Review — Phase 5 (2026-09-10)

Scope: the repository at commit `17c0f45` plus the local Docker stack
(app, Prometheus, Grafana). Focused on §14 of CHOKEPOINT-PLAN.md and the
Phase 5 exit criterion "No credentials or prohibited data in repository".

## Findings

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | No credential files tracked | PASS | `git ls-files` has no `.env`, `.pem`, secret/credential files |
| 2 | No API key values in tracked content | PASS | Only `AISSTREAM_API_KEY` env-var *names* appear in the documented LOCAL-ONLY smoke tools (`scripts/aisstream-*.ts`); values come from `.env` (gitignored) at runtime |
| 3 | `.env` gitignored | PASS | `.gitignore` |
| 4 | Service worker never caches cross-origin or non-GET | PASS | `public/sw.js` (`url.origin !== self.location.origin`, `request.method !== "GET"`), asserted by `tests/unit/pwa.test.ts` |
| 5 | Server blocks path traversal | PASS | `src/server/server.ts` resolves static paths and requires the result to stay inside the static root |
| 6 | Server rejects non-GET/HEAD | PASS | 405 handler; server exposes no mutating endpoints |
| 7 | Key hygiene (§14.1) | PASS | No `src/` module reads credentials; the AISStream key exists only in the host-supplied live adapter path (server-side, untested by CI); server serves fixture mode without credentials |
| 8 | Grafana has no provisioned credentials | PASS | No `GF_SECURITY_ADMIN_PASSWORD` in the repo; anonymous VIEWER access for the local demo only, signup disabled |
| 9 | Metric labels bounded (§13.1) | PASS | Registry enforces registered metrics + label sets; tests assert rejection of unknown names; routes/statuses/rejection categories are enum unions |
| 10 | Log redaction (§13.3) | PASS | `redact()` scrubs key/token/authorization patterns; tests cover query-string, Bearer, and `sk-` patterns |
| 11 | CORS/network exposure | NOTE | The local stack binds published ports on the host; intended for local demo. A public deployment belongs to §10.2/§16.2 with a review of its own |
| 12 | Container hardening | NOTE | Images run as root by default (node:24-alpine base). Acceptable for the local demo; add a USER directive and read-only mounts for any hosted deployment |

## Residual risks (accepted for Phase 5, local-first)

- AISStream key handling in live mode is a local-only feature; the §14.1
  hygiene contract (key appears only in the subscription payload, never in
  logs/attribution/status) is enforced by the adapter and its tests.
- No rate limiting on the local API: acceptable for a single-user local
  stack; required before any public exposure (§10.4, §16.2).

## Verdict

Phase 5 exit criterion "No credentials or prohibited data in repository":
**MET**. No blocker for the local Docker demo in fixture mode.
