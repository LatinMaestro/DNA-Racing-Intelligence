# API-First Data Update Workflow

Status: **current update authority**  
Effective: **27 August 2026**

## Purpose

DNA Racing Intelligence normally refreshes itself from DNA Open Lab v1 through a server-side background sync/backfill process. The owner should not need to download or upload routine exports for ordinary operation once API commissioning is complete.

The existing private CSV Data Updates workflow is preserved but benched. It is an optional future integration and is not a prerequisite for API persistence, Pro League commissioning or private website commissioning.

## Normal update lifecycle

A normal background cycle is:

1. load the last durable checkpoint for the source family;
2. prove API access/scope/rate budget where needed;
3. fetch bounded pages/windows/bulk groups within the current owner policy's
   effective aggregate rate, defaulting and failing back to 30 requests/minute;
4. validate the authoritative response envelope and provider contract;
5. canonicalize provider payloads while retaining provenance/checksum evidence;
6. write private R2 evidence/cache objects where useful;
7. apply bounded idempotent updates to owner-scoped Neon read models/aggregates;
8. verify expected coverage/completeness;
9. atomically publish the completed last-good state and advance checkpoints; and
10. update freshness/current-through/status observability.

A partial cycle cannot replace the previous last-good dataset.

## Source-family plans

| Family             | Normal API behavior                                                  | Publication behavior                                                                        |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Vault/ownership    | bounded current ownership/info refresh                               | publish only after the family refresh validates; local strategy state is never overwritten  |
| Cores              | bounded identity/current supplemental-family refresh                 | timestamp current observations separately from historical analytics                         |
| Finished races     | adaptive time-window crawl plus <=20 race-document hydration batches | backfill is checkpointed and idempotent; a saturated 200-result window is recursively split |
| Active races/fills | short-current-window refresh using documented bounded endpoints      | used for read-only opportunities/field intelligence; stale state remains clearly labelled   |
| Splice Arena/pairs | current Arena plus official pair-info/validation reads               | never performs a splice; local breeding shortlist remains separate                          |
| Tokens             | bounded current/reference refresh                                    | reference/current display only; not historical valuation                                    |

## Zero-cost daily scheduling

The commissioned private website targets one complete API refresh every 24
hours. When any recurring family is due, every recurring family is reacquired
and a new generation is published only after the whole cycle validates. Thirty
requests/minute remains the permanent safe default and burst ceiling while the
bounded refresh is running. The owner may temporarily set any whole-number
aggregate limit from 31 through 150 requests/minute when the current DNA tier
explicitly permits it.

It must:

- prefer bulk endpoints;
- keep an explicit request budget;
- parse available rate-limit headers;
- respect `Retry-After` on 429;
- persist progress before backing off;
- avoid retry storms; and
- continue correctly if a higher 80/150 request tier later becomes available.

Higher tiers may reduce catch-up duration but do not change data semantics.

Current-state acquisition evaluates all recurring families together at the
daily boundary. The shared request pool enforces actual throughput. Pair
info/validation remains on-demand and outside the recurring crawl.

Every elevated rate requires a maximum 31-day expiry. An expired policy, an
advertised provider limit of 30 or lower, or any rate-limit outcome while the
rate is elevated lowers the effective aggregate rate to 30. Recovery never
auto-raises; the owner must deliberately save a new elevated setting.

Cloudflare R2 Standard is guarded by operating budgets set to 80% of the
published free allowances: 8 GB retained storage, 800,000 monthly Class A
operations and 8,000,000 monthly Class B operations. One daily refresh may plan
at most 1,000 Class A and 2,000 Class B operations, or 31,000/62,000 over any
31-day planning horizon. Before discovery or acquisition writes, migration
`0092` atomically reserves the proposed upper bound against a durable,
owner-scoped billing window. The window begins from a provider measurement and
counts both accounted use and every outstanding reservation, so concurrent
refreshes cannot oversubscribe a free allowance. Exact reservation and
accounting replays are idempotent; conflicts, use above the reservation,
overlapping windows and rollover with an unreconciled reservation fail closed.
If any budget would be exceeded, the operator performs no provider request or
write and continues serving the last-good generation. A reservation remains
charged until actual use is explicitly reconciled, including a zero-use
reconciliation after proving that no provider work began. Paid usage is never
enabled automatically. Migration `0093` keeps the original reservation and
accounting timestamps across a process restart; its server-only Neon adapter
uses the stable cycle/request hashes and verifies forced owner isolation before
calling either function.

Before Preview commissioning, project every remaining daily refresh in the
current provider billing window from dated measurements and conservative
per-refresh upper bounds. The projection must confirm R2 Standard storage and
projected R2 and Neon usage within the recurring operating budgets. Neon stops
at 500,000,000 storage bytes and 80,000 milli-CU-hours. A non-Standard
R2 class, an unsafe single-refresh envelope, an exhausted monthly budget, an
out-of-window measurement or an arithmetic overflow fails closed. Reduce the
catch-up cadence to the reported safe count or pause and retain the combined
last-good generation; never enable paid usage automatically.

The private daily operator obtains that projection through a read-only provider
preflight before opening the durable refresh coordinator. Measurements must be
provider-sourced and no more than five minutes old. One sanitized receipt binds
the exact code head, hashed owner scope, refresh cycle, billing window and both
R2 and Neon per-refresh upper bounds. Exact replay produces the same authority;
changing any bound or identity produces a different digest. An unavailable,
failed, malformed, future or stale measurement, or any projected capacity
blocker, returns a held receipt before API, R2 or Neon refresh writes begin.

The concrete server-only measurement source performs exactly two read-only
provider requests: Cloudflare GraphQL queries the documented per-bucket R2
operations and latest storage datasets for the current UTC month, while Neon
`GET /projects/{project_id}` supplies project-wide synthetic storage,
CU-weighted compute usage and the provider's exact consumption-period bounds.
The adapter accepts only its configured owner, requires exactly one matching
Cloudflare account and Neon project, rejects unknown or duplicate R2 operation
classes, rounds compute seconds up to milli-CU-hours and returns only normalized
totals and timestamps. Missing provider fields, project drift, invalid windows,
non-success responses or transport failures are sanitized and fail closed. The
configured writer storage class remains an explicit input because Cloudflare's
R2 analytics datasets do not report object storage class; a value other than
`Standard` is preserved so the projection rejects it.

Run `DNA Open Lab daily refresh provider preflight` from the exact current
`main` head before any bounded Preview refresh. The workflow has read-only
repository permission and receives `AUTHORIZED_CLERK_USER_ID`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY` and
`NEON_PROJECT_ID` only from GitHub secrets. It does not receive a database URL,
R2 S3 writer credentials or DNA API keys. It verifies that `main` remains
unchanged around the measurement and prints only readiness, blocker IDs, safe
remaining cadence and no-write/no-paid-use flags. The receipt is bound to its
exact GitHub commit and a five-minute validity window; rerun the preflight for
the actual commissioning cycle rather than treating an older green run as
persistent authority.

The first historical backfill is a separate bounded commissioning event. It
requires an upper-bound estimate, an exact owner-authorised maximum cost and
explicit P5 approval. Later daily cycles resume only from durable checkpoints
and retrieve missing/new evidence rather than repeating history.

Recurring finished-race history uses the separate versioned cycle/attempt
ledger in migration `0089`. The immutable P5 checkpoint remains untouched.
Each owner-local cycle fixes its bounds and predecessor; first attempts begin
unprocessed, progress is monotonic, replacement attempts carry the exact
superseded checkpoint, and only complete cycles can become the next boundary.
The server-only collector binds each immutable R2 window receipt to checkpoint
progress in one transaction. Before a completed cycle becomes visible,
migration `0091` requires those receipts to form one exact contiguous cover,
match the checkpoint's receipt and document counts, bind exact byte metadata,
and retain the immediately prior published cycle as last-good. The receipt-set
checksum is re-evaluated while
the publication lock is held, so a partial or drifted set cannot cross the
single pointer update. Migration `0092` supplies durable provider-budget
admission; composing finished history and current-state collection into one
complete daily generation remains A2 work. The top-level coordinator now binds
one stable reservation to both runners, advances finished history first and
accounts measured actual use only after a complete combined generation is
durably published. If a process stops between generation publication and
accounting, replay loads that exact generation and accounts its stored actual
use without calling either source runner. Migration `0094` persists that
combined generation and its single owner-local active pointer. Publication
locks and verifies the exact reservation, requires both source publications to
be their current last-good authorities, enforces the finished-history
predecessor and non-regressing current observation, and refuses measured usage
above the reserved envelope. Runtime access is function-only under forced RLS.
The server-only Neon adapter opens a serializable transaction, proves the
database owner matches the authenticated owner and both generation relations
have forced RLS under the non-privileged runtime role, then uses only those
functions. The private operator now composes the durable budget, finished-race
cycle/publication, current-state cycle/publication and combined-generation
repositories behind one explicitly write-armed owner-scoped invocation. It
publishes a complete finished-history receipt set before current-state work,
maps history interruption state into the shared last-good health boundary and
refuses elevated or independent API buckets above the conservative 30-rpm
policy. It is not imported by a route, page, Worker or schedule. The remaining
boundary is switching website reads only through the complete combined serving
pointer, followed by bounded Preview commissioning.

The fail-closed decision packet and its mandatory measurement, stop and cleanup
conditions are defined in
[`DNA_OPEN_LAB_P5_FIRST_BACKFILL_APPROVAL.md`](DNA_OPEN_LAB_P5_FIRST_BACKFILL_APPROVAL.md).
Synthetic capacity evidence and historical counts from a different analytical
universe cannot substitute for the measured complete owner API inventory.

Each acquisition-runner step executes at most one scheduled request through the
shared conservative client pool. Validated evidence must be stored idempotently
before its content-addressed receipt advances the exact-schedule cycle
checkpoint by compare-and-swap. A process crash can therefore replay one
evidence key safely, while plan drift, duplicate receipts and concurrent worker
advancement fail closed. Migration `0075` stores this compact control document
under forced owner RLS and function-only runtime access; its Neon adapter uses
serializable owner-scoped transactions and verifies exact response content.
Raw response bodies are not stored in the checkpoint.

The private R2 evidence sink fixes each object key to the hashed owner, cycle
and logical request. It verifies that public access, `r2.dev` access and custom
domains are disabled before writing, uses create-if-absent publication, and
checks the stored byte count, checksum and identity metadata. If a crash causes
the same request to run again, the first immutable observation remains
authoritative and its original receipt is returned; later response bytes cannot
silently replace it.

The paired evidence reader is the only restart path from an acquisition receipt
back into dynamic plan assembly. It re-verifies private bucket state, the exact
owner/cycle/request object key, head metadata, byte count, checksum, UTF-8 JSON
shape and embedded request identity before exposing an observation. Evidence
whose receipt, metadata, bytes or logical identity disagree fails closed.

Current-state plan assembly is evidence-driven. Validated `vault.cores_full`
and `races.active` observations determine the exact Core bulk and race-fill
requests; caller-supplied stale identity lists are not authoritative. Arena
pages must be contiguous from page 1 with stable page limits and no repeated
Core across pages. A mode with `has_more: true` yields exactly one next-page
request, and the immutable runner schedule is withheld until every selected
mode has one terminal page. The complete schedule is capped at the durable
checkpoint limit of 512 requests.

Dynamic discovery executes as deterministic child cycles derived from one root
cycle: a minimal ownership/active-race/first-Arena-page bootstrap followed by
one bounded continuation round at a time. Every child uses the normal
one-request runner, compare-and-swap checkpoint and immutable R2 sink. A restart
replays completed receipts through the verified reader and resumes the first
unfinished child without rediscovering an already accepted page. The completed
discovery result is only an immutable final acquisition plan; it does not itself
publish or authorize real owner data.

## Finished-race backfill completeness

The finished-race endpoint may return up to 200 races for a time window.

The crawler treats exactly 200 results as possible saturation:

1. request a time window;
2. if result count is below 200, retain the leaf as non-saturated subject to validation;
3. if result count equals 200, split the window deterministically;
4. recurse until every accepted leaf is demonstrably non-saturated;
5. deduplicate by authoritative race identity across adjacent windows; and
6. hydrate full race documents in batches of at most 20.

If an accepted leaf contains a row without authoritative stable identity, do
not canonicalize, deduplicate or hydrate that row. Measurement may count the
observation as a conservative unresolved upper bound, including possible
midpoint-overlap duplication. Persistent acquisition remains blocked unless an
exact measurement-evidence checksum and owner-authorized bound are present.
Under that bounded authority, the worker verifies the private immutable R2
quarantine object, binds its receipt into the accepted window manifest, omits
the row from canonical/statistical publication and advances the cumulative
omission count atomically. Missing authority, authority drift or a count breach
keeps the checkpoint pending and preserves last-good serving.

For the first approved private Preview backfill, the durable Neon ledger stores
one compact row per request-level R2 receipt. A new ordinal can commit only when
it is the next expected request and the compare-and-swap revision, exact
measurement checksum, byte caps and owner scope all agree. The unidentified
finished-race observation is represented only by an omission count on its
verified request receipt; that count and the receipt commit atomically. The run
cannot become complete until every measured request and all six families are
present and the cumulative omission count is exactly one.

The checkpoint records enough information to restart without losing or duplicating accepted coverage.

## Last-good publication

Every family has a last-good state.

- downloaded data is not automatically published;
- validation/canonicalization/storage must complete first;
- expected coverage checks must pass;
- the family checkpoint/publication pointer advances atomically;
- failure leaves the prior publication active; and
- downstream pages continue to use the prior published state.

The first/full current-state cycle is reconstructed only from a
`ready_to_publish` checkpoint whose exact all-family schedule matches every
verified private R2 receipt. Canonicalization and complete-family coverage run
before the single atomic Neon publication call. A later staggered cadence cycle
must not publish until durable cached-family receipt authority proves every
carried-forward non-due group; a timestamp alone is not sufficient evidence.
The receipt index contract preserves the exact source cycle, logical request,
observation time, content checksum and private object key for each full-plan
request. A staggered candidate replaces due-group entries from its current
ready checkpoint and carries non-due entries only from the prior validated
last-good index.

Migration `0076` stores that complete index as one compact generation-bound
document under forced owner RLS and function-only runtime access. Publication
now stages the canonical generation and its index in the same serializable
transaction, then uses an indexed-only publication function; the runtime role
can no longer call the unindexed publication function. Replay must match the
entire JSONB document, and serving reads follow only the current last-good
generation pointer.

Staggered publication reads that serving index through the owner-scoped Neon
repository, constructs the next full-plan index from current due receipts plus
prior non-due receipts, and re-reads every referenced private R2 object from its
original source cycle. A deterministic all-family replay boundary re-runs the
same canonical coverage checks used by a first/full cycle before the mixed
generation crosses the indexed atomic publication transaction. Missing prior
authority, source-cycle drift or incomplete reconstruction preserves the
existing last-good generation.

The website must never appear fresher merely because a failed sync attempt occurred later.

## API eligibility/key loss

Loss of TierBadge eligibility, API-key validity or temporary API availability pauses sync only.

The website must:

- continue serving the last successfully synced data and all retained analytics/read models;
- show a simple sync-paused/stale/current-through indicator where current-state information may now be old;
- retain checkpoints/cursors/windows unchanged except for fully committed work; and
- resume/catch up automatically from the last successful checkpoint when access returns.

Do not clear current data, disable the website or require immediate owner tier restoration.

## Error handling

The body envelope `status: success|error` is authoritative, including DNA's documented HTTP 305 error behavior.

During the protected read-only commissioning inventory, an isolated malformed
response envelope is retried at most twice after the first attempt through the
same aggregate request budget. Every attempt remains included in the measured
API and conservative provider-operation upper bounds. A third malformed
`races.finished` envelope causes its time window to be subdivided, up to a
bounded 64 recovery splits, so valid surrounding races can still be measured.
A persistently unreadable minimum-width window fails closed. An envelope
failure is never reclassified as one omitted race: only a successfully decoded
`races.finished` result containing an unidentified row may enter the separately
bounded quarantine-and-omission policy.

A sync attempt fails closed when:

- the envelope is missing/malformed;
- an error envelope is returned;
- required canonical fields are invalid;
- a request exceeds documented bounds;
- rate-limit rules cannot be respected safely;
- expected coverage is incomplete;
- R2/Neon write verification fails; or
- publication/checkpoint identity drifts.

Optional additive fields do not fail the sync merely because the canonical model does not yet use them; they remain attributable through raw evidence where retained.

## Private evidence handling

Real API payloads never go to Git, CI artifacts, public logs or Issue comments.

Where private raw/full evidence is retained in R2:

- use private buckets only;
- use opaque owner-scoped keys;
- store endpoint/version/retrieval/checksum manifests;
- verify object checksums/metadata on replay; and
- clean bounded scratch/cache residue according to the applicable recovery contract.

## Neon write behavior

Neon writes are owner-scoped and use existing least-privilege/RLS patterns.

Normal sync stores compact state only:

- checkpoints/cursors;
- current canonical records/read models;
- compact historical/analytical aggregates;
- publication/freshness state; and
- local strategy/application state.

Large raw/full evidence remains outside relational tables where R2 is the safer/more economical replay store.

For the approved first private Preview backfill, the request-level persistence
coordinator rehydrates the complete contiguous Neon receipt prefix before it
can continue. It verifies the receipt count, byte total, omission total and R2
writer usage against the durable checkpoint. Each new logical request writes
and verifies its immutable private R2 object first, then advances the Neon
receipt and checkpoint atomically with compare-and-swap revision authority. A
crash between those operations must replay the exact R2 object; changed bytes
or metadata fail closed. Completion uses a deterministic checksum of every
ordered durable receipt and is unavailable until the exact measured request
limit and the one approved quarantine omission are present.

On process restart, the coordinator reads each prior request envelope from R2
through its committed Neon receipt. It rechecks private-bucket state, object
head metadata, exact bytes, checksum, canonical JSON and embedded measurement,
family, ordinal and observation-time authority before acquisition logic may
reuse the stored response. This reconstructs adaptive pagination and current-
state plan inputs without reissuing an already committed API request. Missing
or conflicting replay evidence stops before the first new request or write.
If R2 was committed immediately before a Neon interruption, the same checks
expose that exact next-ordinal envelope as pending so its receipt can be
committed without replacing or reissuing the observation.

The persistent acquisition runner feeds those replayed responses back through
the same fixed six-family adapter that produced the approved inventory. Every
logical request carries a canonical endpoint and argument identity into the R2
envelope. A restart compares that plan identity before returning the response;
drift stops before transport or another provider write. Only the first absent
ordinal may call DNA, and each successful response is written to R2 and bound
to the Neon receipt before the adapter continues. The one authorized malformed
finished-race observation is counted with the crawler's exact stable-`rid`
rules, while saturated windows defer classification until subdivision so a row
cannot be counted twice. The temporary 150 aggregate-rpm commissioning lane
requires exact measurement/cost authority; the normal website default remains
30 aggregate rpm with independent key buckets disabled.

The first persistent commissioning event is available only through the
dispatch-only exact-main workflow. It runs provider prerequisite and ordered
recovery/cleanup checks before a read-only preflight records hashes of the
existing serving, owner-data, checkpoint and retained-evidence state. The
acquisition step cannot start if the exact ledger functions or owner scope are
missing. Its final inspection reconciles the immutable R2 prefix to the Neon
receipt prefix, permits at most the single R2-first next-ordinal object needed
for crash recovery, and requires every pre-existing safety fingerprint to be
unchanged. It performs no candidate or last-good publication.

## Persistent real Preview gate

A configured API key does **not** authorise persistent real backfill.

Before the first persistent real Preview sync:

1. connected discovery proves the real API shapes and intended authority needed by the persistence slice;
2. API-first persistence is based on that evidence;
3. P5 proves PostgreSQL 18 physical/peak capacity and R2 footprint/cost;
4. recovery/replay/partial failure/rate limit/tier loss/catch-up are proven;
5. explicit positive Neon headroom below 536,870,912 bytes is demonstrated; and
6. the owner explicitly approves the first persistent real Preview sync.

Until that approval, connected reads may be used only within the authorised read-only evidence boundary and synthetic/replay work may continue.

## Freshness model

Every relevant family exposes:

- last successful sync time;
- source/current-through time where meaningful;
- backfill coverage/current window where meaningful;
- current/ageing/stale/unknown state;
- sync paused/error state where needed; and
- last-good publication identity.

Current API facts should be described as current observations only when their timestamp/freshness supports that wording. Historical analytics retain their own event/current-through cutoff.

## Automatic post-race ingestion

When the owner has participated in a race, no special manual upload should be required after API commissioning.

The normal finished-race sync/backfill path should:

- discover the completed race through bounded finished windows;
- hydrate the race document;
- reconcile owned-Core participation;
- update canonical historical evidence and affected aggregates idempotently; and
- expose recent-race/readiness changes after last-good publication.

Post-P5 collection uses a separate stable cycle per bounded refresh window.
Each accepted R2 window receipt and its checkpoint advance commit atomically;
split-only progress carries no publication receipt. API or response failures
pause the exact checkpoint, honour provider retry metadata and retain the
serving last-good generation. Completing collection does not activate the new
evidence: complete receipt validation and one consistent generation publication
remain separate required steps.

The website remains read-only and never enters the race.

## Optional CSV workflow — benched

The pre-existing private Data Updates implementation is preserved for possible later use, but new CSV work is paused. No CSV is required from the owner for current delivery.

An API gap is shown as an unavailable/limited capability. It does not automatically reactivate the CSV workflow. Resuming CSV integration requires a separate owner-approved backlog decision.

Fallback imports preserve the established controls:

- private raw object storage;
- checksum/schema/version detection;
- preview before activation;
- idempotent replay/deduplication;
- conflict quarantine;
- rollback/recovery;
- freshness/current-through separation; and
- no unapproved paid-capacity or Production change.

Spreadsheet-specific optimisation is not a delivery priority unless a demonstrated API gap requires it.

## Optional API-vs-CSV equivalence — deferred

The existing equivalence harness remains safety-tested and preserved, but equivalence is not an exit criterion for P3, P4, P10 or full website commissioning. If the owner later resumes this optional work, representative facts may be compared privately, including where applicable:

- race IDs;
- entrants/Core IDs;
- event times;
- elapsed times and positions;
- mode/distance/gates;
- Gold/Blue evidence;
- fees/prizes/token;
- payout format/tags;
- Core identity/lineage;
- Arena/current ownership; and
- relevant counts/aggregates.

Differences must be classified rather than silently resolved. Optional CSV evidence must not overwrite the API critical-path authority or local strategic state automatically.

Detailed comparison reports contain private entity identities and remain inside the approved ephemeral/private processing boundary. Connected CI and repository documentation may receive only count-only redacted summaries grouped by canonical field and entity family. Those summaries must omit entity keys, API/CSV paths, filenames, checksums and all scalar source values. Duplicate entity reports and inconsistent field contracts fail closed before aggregation so counts cannot be inflated or compared under different semantics.

## Owner-facing operations

After API commissioning, the owner should normally see a compact API operations/freshness panel rather than an upload-first workflow.

It should show:

- last sync by family;
- current-through/backfill state;
- sync paused/stale state;
- recent completed races;
- current active opportunities where available;
- unresolved API schema/capability issues; and
- recovery/catch-up status.

Routine operation should not require direct database access or manual file replacement.

## Historical upload-first evidence

Before 27 August 2026, the project was designed around periodic CSV uploads. That implementation remains preserved as historical engineering evidence and a possible optional future integration in Git history and the specialised Phase 1 documents.

Where earlier documentation states that the owner must routinely download/upload Race Merge/Core Details/Arena exports, this API-first workflow supersedes that operating model.
