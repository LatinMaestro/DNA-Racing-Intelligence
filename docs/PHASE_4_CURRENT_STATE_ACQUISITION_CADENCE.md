# Phase 4 current-state acquisition cadence

## Scope

This slice adds deterministic scheduling policy above the existing DNA Open Lab
request budget, three-key client pool, current-state request plan and complete
`0074` publication contract. It makes no network request and does not schedule a
hosted job.

The intervals below are an explicit application freshness policy. They are not
represented as DNA endpoint guarantees or API semantics:

| Acquisition group  | Minimum local interval | Recurring evidence                                         |
| ------------------ | ---------------------- | ---------------------------------------------------------- |
| Race activity      | 1 minute               | active races and bounded fill batches                      |
| Token prices       | 5 minutes              | current/reference-only Token prices                        |
| Vault identity     | 15 minutes             | Vault info, ownership, tier badge and recent-race identity |
| Core current state | 15 minutes             | bounded identity plus seven supplemental Core families     |
| Splice Arena       | 30 minutes             | complete paginated Arena modes/pages/listings              |

Official pair info and pair validation remain explicit on-demand reads. They do
not enter the recurring crawl, do not prove a completed splice and never perform
a transaction.

## Request and publication boundaries

- Recurring requests are grouped deterministically and partitioned into batches
  no larger than the conservative base allowance of 30 aggregate requests.
- A logical batch is not permission to bypass the client pool. Every request
  must still pass through its lane budget and the shared aggregate budget.
- `X-RateLimit-*`, `Retry-After`, 429 and a lower observed allowance can only
  delay work. An advertised 80/150 tier cannot raise the configured 30-request
  aggregate ceiling.
- Slow groups may reuse timestamped last-good evidence until their next local
  cadence boundary. A new generation is publishable only after every due group
  succeeds and every group has cached-or-refreshed evidence.
- Missing, partial or future-dated evidence blocks publication and preserves the
  previous serving generation.

## Recovery

A rate limit, eligibility loss, unavailable API or invalid payload produces a
non-destructive pause directive. It never retries the failed request blindly,
always preserves last-good data and requires catch-up. `Retry-After` is preferred
over reset metadata when both are available.

The HTTP status alone does not redefine DNA's body-envelope authority. A body
error is classified as eligibility loss only during the explicit eligibility
probe (or on HTTP 401/403); the same HTTP 305 quirk during an ordinary payload
request is not invented as proof of eligibility loss.

## Safety and next step

All evidence is synthetic and local. No DNA API call, hosted Neon/R2 mutation,
deployment, Production change or persistent owner-data write occurs. Persistent
real owner-data synchronization remains blocked by the P5 owner-approval gate.

The next P4 slice is the bounded acquisition runner: dispatch scheduled requests
through the conservative client pool, retain validated family evidence, persist
pause/catch-up state through the publication repository and prove restart-safe
cycle checkpoints.
