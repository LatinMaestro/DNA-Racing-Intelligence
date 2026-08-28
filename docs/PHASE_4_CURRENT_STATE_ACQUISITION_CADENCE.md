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

## Bounded runner and cycle safety

The acquisition runner now advances at most one scheduled request per step. It
routes that request through the existing conservative client pool and records a
content-addressed evidence receipt before advancing a compare-and-swap cycle
checkpoint. The checkpoint binds the exact schedule-evaluation boundary, due
groups, ordered request keys, accepted receipts, completed groups, pause reason
and retry boundary. Each receipt retains its actual attempt/observation time; a
restart with a changed plan or schedule fails closed.

Evidence persistence is deliberately injected. Its implementation must be
durable and idempotent by request key; a crash after evidence storage but before
checkpoint advancement may replay the same key. Raw response bodies never enter
the checkpoint. The runner excludes pair reads, advances no more than one
request/checkpoint at a time, and cannot mark a cycle ready until all due
requests plus cached-or-refreshed evidence are complete.

The runner contract is implemented and synthetically proven. Migration `0075`
persists each cycle as a compact owner-scoped document with forced RLS,
function-only runtime access, immutable schedule authority, append-only receipt
progress, terminal-state protection and compare-and-swap revisions. The Neon
adapter verifies the authenticated owner and least-privileged runtime posture
inside every serializable transaction and rejects response drift. The private
R2 evidence sink remains the next P4 slice; no checkpoint schema has been
applied to a hosted provider.

## Safety and next step

All evidence is synthetic and local. No DNA API call, hosted Neon/R2 mutation,
deployment, Production change or persistent owner-data write occurs. Persistent
real owner-data synchronization remains blocked by the P5 owner-approval gate.

The next P4 slice is the private immutable evidence-sink contract, followed by
dynamic ownership and Arena-pagination assembly. These remain synthetic until
the P5 gate.
