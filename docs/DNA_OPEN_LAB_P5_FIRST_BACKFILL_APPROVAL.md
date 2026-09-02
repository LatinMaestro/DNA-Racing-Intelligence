# DNA Open Lab P5 first historical backfill approval

## Current conclusion

The first persistent private Preview historical backfill is now authorized
within the exact bounded owner approval recorded on 2 September 2026. Exact-main protected run
`33574168582` completed the ten-case recovery suite and all six read-only
inventory families from commit
`9fc47d6b1ba95287349cbd18023254058dd744e0`, emitted its sanitized artifact and
verified zero persistent writes and zero residue. Projection policy version 2
measured 1,136,911 source records, 34,906 API requests, 1,151,071,826 retained
private R2 bytes, 489,717,760 peak Neon bytes and a $0.212250 one-time cost upper
bound. The 536,870,912-byte Neon ceiling retains 47,153,152 bytes of projected
headroom.

The same run measured exactly one unresolved finished-race observation. It is
within the owner-authorized de minimis classification ceiling and is never
treated as a DNA race. The persistent worker binds the exact measurement
evidence and count authority into its checkpoint, archives the raw observation
in private immutable R2 quarantine, excludes it from canonical
identity/statistics and binds the quarantine receipt into the accepted window
manifest. Changed authority or a cumulative count above the measured bound
fails closed.

The sanitized measurement evidence SHA-256 is
`250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4`.
The owner authorized up to $0.500000 for this one commissioning event, covering
the measured $0.212250 upper bound, and accepted the exact one-observation
quarantine/omission authority plus every mandatory stop and cleanup condition
below. This authority permits only the first persistent private Preview
backfill. It does not permit Production, paid capacity, public access or a game
transaction.

The connected capacity run `33227770750` remains valid evidence for PostgreSQL
18 peak/headroom and a bounded synthetic R2 cost projection. It does **not**
measure the retained bytes, operations or provider cost of the first complete
historical API backfill. Likewise, the completed 632,445-record breeding census
is useful scale context but covers a different analytical universe and is not a
measured upper bound for the commissioned owner API backfill. Neither may be
substituted for the required measurement.

## Ordered gate

The decision packet advances only in this order:

1. All seven P5 technical requirements are satisfied by exact-head connected
   evidence. Local or stale evidence does not qualify.
2. A non-persistent measurement inventories the complete API history in scope
   from an exact `main` commit and point-in-time authority cutoff, then records
   conservative upper bounds for source records, API requests, retained private
   R2 bytes, R2 Class A and Class B operations, Neon peak bytes and total
   one-time cost. Pricing authority and sanitized evidence references are
   mandatory.
3. The owner receives that measured upper bound, the exact proposed maximum
   authorized amount and the conditions below.
4. Only an explicit bounded owner approval may set both the approval reference
   and maximum authorized micro-USD. The maximum must cover the measured
   projected upper-bound cost.
5. That approval permits only the first persistent **private Preview** backfill.
   It does not permit Production, a public route, paid capacity or any game
   transaction.

The implementation is `lib/dna-open-lab-p5-first-backfill-approval.ts`. It
fails closed if technical evidence, complete-inventory measurement, the exact
cost maximum or approval reference is absent or inconsistent.

The non-persistent measurement contract is
`lib/dna-open-lab-p5-first-backfill-measurement.ts`. It requires exactly one
terminal observation for finished-race history and each of the five recurring
current-state acquisition groups. Finished races are classified only as the
available paginated history at the authority cutoff; Vault recent-race state is
bounded/recent-only; and race activity, token prices, Core state and Splice
Arena are current-only. State absent from those API responses cannot be
reconstructed later or relabelled as historical evidence.

The contract can run only after the protected recovery suite passes from the
same exact clean `main` commit. It binds the acquisition-plan checksum, fresh
pricing authority, zero persistent writes, zero temporary residue and sanitized
per-family evidence. It computes the R2 storage/Class A/Class B, DNA API and
Neon upper-bound costs. A non-positive Neon headroom result is emitted with
`neonCapacityWithinLimit=false` and produces `blocked_capacity`; it cannot be
authorized for persistence. The approval-packet input always keeps owner
approval and all persistent writes disabled during measurement.

The historical authority cutoff is fixed before acquisition. Each family also
records its own completion timestamp, and the aggregate measurement timestamp
is taken only after all six families and cleanup finish. Every family timestamp
must fall between the historical cutoff and measurement completion. This makes
the unavoidable capture interval explicit: current-only endpoints are never
misrepresented as though they were an instantaneous snapshot taken at the
earlier finished-race cutoff.

The connected emission boundary is
`lib/dna-open-lab-p5-first-backfill-measurement-invocation.ts`. It rejects a
changed head or unsafe measurement before emission, hashes every private family,
recovery-run and pricing reference, emits only aggregate six-family counts and
bounds, and caps the canonical artifact at 32 KiB. The boundary never includes
raw payloads, Vault/Core/race identities, credentials or provider configuration.

The inventory orchestration boundary is
`lib/dna-open-lab-p5-first-backfill-inventory-runner.ts`. It executes the six
families in the reviewed order and requires every API request to cross the
shared client pool with independent-bucket mode disabled. The standing ceiling
is 30 aggregate requests/minute. A dispatch may use the separately owner-approved
150 aggregate requests/minute commissioning override only when both the explicit
rate choice and its confirmation are present. It counts real requests and
serialized response bytes internally, rejects incomplete or understated family bounds,
always verifies zero writes/residue and then calls the aggregate-only emission
boundary. It does not itself define endpoint pagination, history cutoffs or
storage multipliers; the protected connected adapter must supply and test those
family-specific authorities before the measurement can run.

The endpoint-specific read-only adapter is
`lib/dna-open-lab-p5-first-backfill-family-adapter.ts`. It now supplies the
terminal acquisition side of that contract: adaptive `races.finished` windows
through the exact authority cutoff, active-race fills in documented batches,
the token snapshot, all four Vault identity/recent endpoints, all eight owned-
Core bulk endpoints in batches of 20, and every Bike/Car/Horse Arena page until
the API reports `has_more: false`. It rejects family-order drift, duplicate
authorities, malformed identities, response-page drift, changing Arena page
limits and endpoint-capacity breaches. The adapter records only aggregate
request, byte and record observations plus a SHA-256 aggregate evidence
reference.

For measurement only, a non-saturated finished-race leaf may contain a row
without an acceptable stable `rid`. The adapter counts every such leaf
observation as an unresolved identity upper bound while retaining no payload or
identifier in evidence. It does not treat the observation as a canonical race,
deduplicate it, hydrate it or silently discard it. Evidence schema v4 keeps
`sourceAuthorityComplete=false`. The approval packet remains
`blocked_source_authority` unless a reviewed omission authority matches the
exact measurement evidence SHA-256 and unresolved count and stays within the
hard 25-observation ceiling. Owner cost authorization alone cannot override
this boundary.

The reviewed projection policy is
`lib/dna-open-lab-p5-first-backfill-projection-policy.ts`. It converts each
terminal family observation without provider writes or price assumptions. One
logical API request retains one uncompressed immutable R2 evidence object with
a 16 KiB canonical envelope allowance. API and Class A bounds allow one replay,
R2 audit coverage includes two complete paginated listings, and Class B allows
six integrity/reconstruction reads per logical object. Compact-Neon physical
peak follows the persistence class. Finished-race history is archive-first and
receives 24 KiB per logical request for window receipts, indexes and overlap
plus 2 MiB family overhead, with no per-race Neon row. Recurring current-state
families receive 16 KiB per source record, 8 KiB per logical request and 2 MiB
family overhead, including candidate/last-good overlap. Full response bytes
remain in R2. The policy fails closed on arithmetic overflow or when any
observed response plus its envelope would exceed the existing 8 MiB immutable
evidence-object boundary.

The matching persistent evidence boundary is
`lib/dna-open-lab-p5-first-backfill-r2-evidence.ts`. It stores one canonical
request/response envelope per measured logical request beneath an opaque
owner-scoped and measurement-scoped private R2 key. A stable global request
ordinal prevents two families from claiming the same priced object slot.
Existing objects must match the exact bytes and metadata; a durable receipt may
resume usage accounting without another PUT. The writer stops before exceeding
17,453 logical evidence objects, 1,151,071,826 retained bytes, the 8 MiB object
limit or the 16 KiB per-request envelope allowance from run `33574168582`.

The generic historical race hydrator that fetches `races.docs` and writes one
R2 object per race is not the execution path measured by this approval. Applying
it to more than 1.13 million finished races would add unpriced API requests and
Class A operations. It is therefore prohibited for this one-time commissioning
event unless a new complete measurement and bounded owner approval explicitly
price that different plan.

The policy is not capacity evidence by itself. The protected same-head
measurement must still combine it with the current Neon baseline, the approved
512 MiB limit, fresh provider pricing and the connected recovery proof. Until
that composition runs, the packet remains blocked and no persistent owner-data
write is permitted.

The protected composition is
`.github/workflows/dna-open-lab-p5-first-backfill-measurement.yml`. It may be
dispatched only from current `main`; re-proves provider prerequisites, runs the
ordered connected recovery suite and cleanup, then executes the six-family
non-persistent inventory with the reviewed projection policy. The default is
the shared 30 aggregate requests/minute pool. The owner-approved retry may use
150 aggregate requests/minute only when the dispatch explicitly selects 150 and
checks the matching confirmation; independent rate buckets remain disabled, so
this never means 150 per key or 450 aggregate. The workflow reads the compact-Neon
baseline but writes no owner data, re-proves provider safety and unchanged main, and uploads only
the sanitized recovery JSONL plus aggregate measurement JSON for seven days.
It does not record owner approval or enable the persistent backfill.

Connected failures emit only an allowlisted acquisition code, the active source
family, completed-family count, aggregate request count and rate-limit count.
Long crawls also emit a count-only request milestone every 500 requests. These
diagnostics never include an exception message, URL, time window, entity ID,
payload value, key, Vault reference or provider credential. Cleanup still runs
before the workflow fails, and an acquisition failure still produces no
approval artifact. A terminal six-family measurement may emit a sanitized v4
cost-bound artifact with an unresolved identity count. It becomes
decision-ready only through the exact bounded quarantine-and-omit authority;
the artifact alone never authorizes persistence.

## Mandatory stop conditions

The commissioning backfill performs no further provider request or write when:

- projected cost exceeds the exact owner-authorized maximum;
- paid provider capacity would be required;
- any provider safety budget would be exceeded;
- measured Neon headroom is not positive;
- API rate, eligibility or response-body authority fails;
- evidence, checkpoint or complete-generation validation fails; or
- repository, owner, acquisition-plan or point-in-time authority drifts;
- an unidentified finished-race observation lacks a verified private
  quarantine receipt; or
- the cumulative unidentified observation count exceeds the exact measured and
  owner-authorized omission bound.

The standing 30 aggregate requests/minute ceiling remains an upper limit, not a
target. The one-run commissioning override is capped at 150 aggregate requests
per minute and does not alter the commissioned website or daily-refresh policy.
Provider `X-RateLimit`, `Retry-After`, endpoint bulk and health signals may lower
either configured ceiling further.

## Mandatory cleanup and recovery

On any stop or failure the worker must:

- keep serving the last-good generation;
- preserve the last committed durable checkpoint;
- delete the incomplete generation; and
- prove temporary R2 and Neon residue is zero before reporting completion.

After a successful first backfill, normal operation returns to checkpoint-only
daily catch-up under the existing zero-ongoing-cost budgets. A successful P5
packet never enables paid capacity automatically.
