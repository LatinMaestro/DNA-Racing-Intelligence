# Phase 4 owner API sync rate control

## Decision

The commissioned private website targets one complete bounded refresh every 24
hours. All recurring current-state families are reacquired together and share
one aggregate request budget. The rate setting controls burst throughput only;
it does not create a continuous website crawl.

The authenticated owner can enter any whole-number aggregate limit from 30 to
150 requests per minute from the private **API Sync** page, with 30, 60, 90,
120 and 150 provided as quick browser suggestions. The setting controls
server-side acquisition only. API keys, response bodies and provider
credentials never enter the browser or policy table.

## Fail-safe behavior

- 30 requests/minute is the permanent safe fallback and default.
- Any setting above 30 requires an expiry of 1 hour, 24 hours, 7 days or 31 days.
- Expiry lowers the effective rate to 30 and never raises it automatically.
- An authoritative provider limit of 30 or lower lowers the effective rate to
  30 immediately.
- Any rate-limit outcome while elevated lowers the effective rate to 30,
  including when DNA does not supply a trustworthy provider limit.
- A later success clears the consecutive-error counter but cannot undo a
  fallback. The owner must deliberately save a new elevated policy.
- `Retry-After`, response-body status, per-key health and the lower observed
  provider allowance still delay acquisition independently of this policy.

## Persistence and execution

Migration `0083` stores one owner-scoped policy under forced RLS and exposes
function-only reads, optimistic owner writes and sanitized rate observations.
It stores no key, raw response or wallet data. Each worker boundary constructs
the shared client pool from the effective policy. Only a sanitized rate-limit
outcome and numeric advertised limit are persisted; successful requests do not
create policy-table write volume. Scheduler batches use the same effective
aggregate rate.

Daily cycles remain bulk-first, checkpointed, idempotent and last-good. When
any recurring family is due, all recurring families are fetched for one
complete generation. R2 monthly and per-refresh free-tier guards run before
provider work and fail closed before paid use.

This implementation adds no hosted migration, deployment, public route, paid
plan, wallet connection or game transaction.
