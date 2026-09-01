# DNA Open Lab P5 first historical backfill approval

## Current conclusion

The first persistent private Preview historical backfill remains prohibited. The
packet is currently `blocked_measured_upper_bound`. Exact-main connected run
`33467686923` completed the protected ten-case recovery suite, so all seven P5
technical requirements are satisfied. The owner's general approval intent for
real API data is recorded, but it is not yet the required bounded authorization:
the exact one-time upper-bound amount has not been measured or presented.

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
Neon upper-bound costs, rejects a non-positive Neon headroom result and emits an
approval-packet input with owner approval and all persistent writes still
disabled.

## Mandatory stop conditions

The commissioning backfill performs no further provider request or write when:

- projected cost exceeds the exact owner-authorized maximum;
- paid provider capacity would be required;
- any provider safety budget would be exceeded;
- measured Neon headroom is not positive;
- API rate, eligibility or response-body authority fails;
- evidence, checkpoint or complete-generation validation fails; or
- repository, owner, acquisition-plan or point-in-time authority drifts.

The 30 aggregate requests/minute ceiling remains an upper limit, not a target.
Provider `X-RateLimit`, `Retry-After`, endpoint bulk and health signals may lower
it further.

## Mandatory cleanup and recovery

On any stop or failure the worker must:

- keep serving the last-good generation;
- preserve the last committed durable checkpoint;
- delete the incomplete generation; and
- prove temporary R2 and Neon residue is zero before reporting completion.

After a successful first backfill, normal operation returns to checkpoint-only
daily catch-up under the existing zero-ongoing-cost budgets. A successful P5
packet never enables paid capacity automatically.
