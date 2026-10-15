# Neon transfer recovery and monthly efficiency

Status: 15 October 2026; metadata and source-code audit, not connected acceptance.
Owner requested a fix for this month and a more efficient recurring design.

## Verified constraint

The DNA project's October network-transfer counter is 5,695,839,591 bytes;
the billing window ends 1 November 2026 00:00 UTC / 10:00 Brisbane. The accepted
operating ceiling remains 4,750,000,000 bytes, below the published 5 GB Free
allowance. Deleting data, changing pooling, creating a branch or compressing a
client-side dump does not undo already-recorded transfer. No local quota-reset
operation is documented. Do not run a database dump to investigate this.

Recent branch metadata attributes the recorded transfer to Preview, with zero
recorded Production transfer. This identifies an environment, not a query-level
cause. No SQL statistics were queried or reset. No measured share of the 5.70 GB
is attributed to the source-code risks below.

Official authority, checked 15 October:

- https://neon.com/docs/introduction/network-transfer
- https://neon.com/pricing
- https://neon.com/programs/open-source
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers
- https://developers.cloudflare.com/r2/pricing/

## This month's recovery decision

| Route                                                  | Feasibility and remaining proof                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing exhausted Neon project                        | Cannot be restored to free headroom by code. Requires fresh reset proof or a provider-approved allowance/credit arrangement with enforceable A$0 protection. Neither is assumed.                                                                                                                                                                                                 |
| R2 to temporary PostgreSQL in a standard GitHub runner | Technically possible without Neon transfer for evidence already retained independently in R2. Must first prove accepted manifest/checksum/cutoff authority, owner scope and current R2 storage/Class A/B headroom. Do not publish private rows to public logs, artifacts, caches, Pages or releases. This is a temporary processing environment, not a durable website database. |
| Separate Free Neon commissioning project               | Conditional, not an automatic reset. Current Free terms provide per-project limits. Rebuild only from independently retained accepted evidence; preserve the existing project and do not copy via an unsafe Neon export. Full owner registry, strategy, correction and publication state must be reconciled. No project was provisioned or switched.                             |
| Open-source credits or one-off support accommodation   | Application/provider decision. Public code alone does not meet the recognised-licence/self-hostability requirements. GitHub reports no recognised repository licence. No licence change, application, support message or paid-plan activation is authorised by this document.                                                                                                    |

**Current missing dependency:** the retained R2 payloads are not yet a proven
standalone replacement for the whole application state. The existing hosted
archive reader obtains locators/manifests from Neon; active Core-history reads
use the Neon publication pointer/rows; existing R2 budget reservations are also
Neon-backed. A raw object or source CSV alone cannot replace those authorities.
Portable accepted manifests and an independently safe read-budget path must be
proved before claiming R2-only commissioning. Owner corrections and strategy
available only in Neon remain unavailable, never reconstructed by guessing.

Neon's quota does not technically exhaust R2's allowance. Independently safe
R2-only work can be considered under its own verified provider limits, provided
it has no hidden Neon dependency and preserves the accepted source authority.
The existing coupled commands remain blocked. Do not relax their safety checks
or call synthetic evidence real commissioning.

## Immediate implemented containment

Two hourly workflows previously reached database operations before their later
capacity gate:

- Race Merge continuation resolves its predecessor through `psql` first.
- Population-index continuation applies/smokes migrations and inspects state
  before later capacity-gated materialization.

An inspected 14 October Race Merge run failed at the predecessor SQL step with
a quota-related failure. A later sampled run stopped earlier on head drift;
these are distinct causes and neither proves historical byte attribution.

Both workflows now depend on a separate metadata-only transfer job before the
connected job can start. It has no database URL or R2 credentials, makes one
10-second-bounded Neon project GET with redirects/retries disabled, and emits
only a fixed aggregate receipt. Missing configuration, HTTP/transport failure,
malformed/missing transfer, wrong project, stale billing window or usage at or
above the operating ceiling holds the connected job without a database
connection. A future calendar date alone cannot pass the gate.

Scheduled history is deferred by default unless the repository variable
`DNA_ENABLE_DEFERRED_HISTORY_SCHEDULE` is exactly `true`. It must remain deferred
until the accepted commissioning priority permits catch-up. Explicit manual
dispatch still retains its existing arming, exact-main and downstream full
capacity checks. A skipped or held run cannot dispatch a continuation. No
automatic reset-date resumption is introduced.

This is an early admission check, not a reservation for an entire future run.
It neither reopens this month's database nor replaces storage/compute/R2
preflights or permission to run the deferred work.

The Cloudflare Preview provider workflow is also manual-exact-main only before
any provider credential is exposed. Its separate first job holds unless a
manual dispatch targets current `main` and the same metadata-only transfer
check passes. Pull requests therefore cannot reach Neon SQL, R2 inventory,
Cloudflare queue reads or Worker deployment. Passing this early gate still does
not authorize material work: the later full-run Neon/R2 forecast, durable
reservation, privacy and deployment gates remain required.

## Future-month priorities preserving the analytical method

| Priority | Verified source-code risk / required improvement                                                                                                                                                                                   | Acceptance                                                                                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | `loadActiveProLeagueVaultEvidence` reads every population profile through `listActiveRows`, validates the generation, then selects owned cores on each page composition. Publish a compact owner view once per generation instead. | Retain full-generation validation at publication, global coverage counts, exact source digest, Bike/type/distance evidence, source cutoff and owner/roster versions. Unchanged existing analytical outputs; no truncation, reduced population or dropped integrity checks.                               |
| P0       | Full active Core-history traversal is paginated but still reads the entire generation. Reserve it for bounded materialization, not routine page requests.                                                                          | Immutable accepted source identity, resumable verified replay and last-good publication; reuse existing deterministic methods.                                                                                                                                                                           |
| P0       | Vault Performance still needs compact persistence/read adapter after PR #950's snapshot contract.                                                                                                                                  | At most one validated owner summary per page, exact decimals/assets/coverage/freshness, no raw-ledger scan, source/correction invalidation.                                                                                                                                                              |
| P1       | Repeated generation reads and page composition can transfer unchanged evidence.                                                                                                                                                    | Cache only accepted derived views, keyed by owner + generation + relevant registry/strategy/method versions. Authenticate before access; invalidate on corrections/ownership/source change. Never share private owner data through public CDN caching.                                                   |
| P1       | Existing connected source rejects already-exhausted transfer, but the generic recurring projection models future storage/compute, not future transfer bytes.                                                                       | Add conservative per-operation transfer bounds and durable concurrent reservations, plus a remaining-month forecast and explicit website/recovery reserve before costly work. Unknown bounds hold; do not default missing transfer to zero.                                                              |
| P1       | Per-query byte attribution is currently unavailable.                                                                                                                                                                               | Collect sanitized per-operation counts/returned-payload byte bounds and correlate against dated project/branch counter deltas when safe. JSON bytes are a lower bound, not exact PostgreSQL wire billing. Use bounded SQL diagnostics only after safe headroom; do not reset statistics as a first step. |
| P2       | Repeated current-state refresh and exports can multiply transfer.                                                                                                                                                                  | Retain change-aware/incremental publication, independent 24-hour non-race refresh, on-demand pair reads and existing bounded race deltas. No periodic lifetime replay/dump and no newly broadened API collection.                                                                                        |

As a sizing illustration, 1 MB returned 100 times/day consumes 3.1 GB in a
31-day month. Smaller pages alone do not help if every page is still fetched.
This is an example, not measured current traffic. The 4.75 GB operating budget
averages roughly 153 MB/day over 31 days, **including** website and recovery;
it must not all be assigned to background work. Set workload allocations from
measured conservative bounds before enabling recurring execution.

No analytical formula, rank, sample threshold or historical evidence is changed
by this containment. No owner-data SQL, R2 data transfer, export, migration,
deployment, game action or paid use was performed during this audit. The
current website and database remain uncommissioned under the transfer block.
