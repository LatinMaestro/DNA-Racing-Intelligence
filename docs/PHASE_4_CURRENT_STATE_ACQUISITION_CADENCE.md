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
| Race activity      | 24 hours               | active races and bounded fill batches                      |
| Token prices       | 24 hours               | current/reference-only Token prices                        |
| Vault identity     | 24 hours               | Vault info, ownership, tier badge and recent-race identity |
| Core current state | 24 hours               | bounded identity plus seven supplemental Core families     |
| Splice Arena       | 24 hours               | complete paginated Arena modes/pages/listings              |

The shared boundary deliberately creates one complete daily website refresh.
If any family is due, every recurring family is due. This is the owner's
zero-ongoing-cost policy, not a claim about DNA endpoint freshness.

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
- A new daily generation is publishable only after every recurring group
  succeeds. Failed cycles keep the previous complete generation.
- Missing, partial or future-dated evidence blocks publication and preserves the
  previous serving generation.
- Before discovery or acquisition, the operator checks current R2 use plus the
  proposed refresh against hard 80%-of-free-tier budgets: 8 GB storage, 800,000
  Class A and 8,000,000 Class B operations. A daily refresh is capped at 1,000
  Class A and 2,000 Class B operations. Budget exhaustion performs no provider
  work and serves last-good data rather than incurring paid usage.

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
R2 sink now stores canonical bounded evidence under a hashed-owner,
cycle-and-request identity, requires a private bucket, verifies immutable object
metadata and returns the original stored receipt on crash replay. No checkpoint
schema or evidence object has been applied to a hosted provider.

Dynamic plan assembly now consumes validated ownership, active-race and Arena
page observations. It sorts the discovered identities, expands bounded Core and
fill batches, emits only the next missing Arena page, and refuses a final plan
until every selected mode has contiguous terminal coverage. Duplicate
identities, page/limit drift, post-terminal pages and schedules above the
512-request durable-cycle capacity fail closed.

## Safety and next step

All evidence is synthetic and local. No DNA API call, hosted Neon/R2 mutation,
deployment, Production change or persistent owner-data write occurs. Persistent
real owner-data synchronization remains blocked by the P5 owner-approval gate.

The durable bootstrap/continuation executor and full-cycle publication runner
now feed exact receipt authority into migration `0076`. That migration stores
one compact owner-RLS receipt index per generation, and the publication adapter
atomically stages it with canonical data before an indexed-only publish. The
staggered cycles reconstruct from current due receipts plus verified last-good
non-due receipts, re-read every immutable object from its source cycle, re-run
full-family validation and use the indexed atomic publish. The durable scheduled
coordinator derives cadence only from the serving receipt index, forces a full
cycle on dynamic-plan drift, advances at most one bounded request per invocation
and selects full or staggered publication only after the durable checkpoint is
ready. API interruptions update both the cycle checkpoint and last-good pause
state. One operator boundary now composes durable identity/Arena discovery with
that scheduled coordinator without increasing the one-request-per-invocation
bound. The explicit P4/P5 readiness and recovery matrix now distinguishes local
implementation evidence from connected acceptance, physical/cost measurements
and owner approval. The bounded recovery harness now runs one fixed case per
invocation with exact-head/scope authority, strict redaction, zero real-owner
writes and zero residue. The current gate remains closed. The next safe slice is
the concrete recovery scenario adapters and API-only capacity measurement
design. This remains synthetic until the P5 gate.
