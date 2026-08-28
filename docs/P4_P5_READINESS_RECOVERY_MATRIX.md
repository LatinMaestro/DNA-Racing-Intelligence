# P4/P5 readiness and recovery matrix

## Authority

This matrix records repository truth for the first persistent real owner-data
sync in a protected private Preview. It does not authorise that sync. Every P5
technical requirement must have exact evidence and the owner must then approve
the first persistent Preview sync explicitly.

Production schema, data, deployment, API secret and game actions remain separate
later approval gates. P5 approval can never authorise Production.

## Current matrix

| P5 technical requirement                | Current evidence                                                                        | Remaining proof                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Restart, replay and idempotency         | Local synthetic CAS checkpoint, immutable R2 first-write and replay-conflict tests      | Connected private Preview restart/replay acceptance         |
| Partial failure and rate-limit recovery | Local synthetic 429, invalid-payload, outage and partial-cycle tests preserve last-good | Connected private Preview recovery acceptance               |
| Tier loss, reinstatement and catch-up   | Local synthetic eligibility pause and catch-up state tests                              | Connected private Preview loss/reinstatement acceptance     |
| Stale cached website operation          | Local owner-scoped last-good read and pause tests                                       | Protected Preview stale-site acceptance                     |
| PostgreSQL 18 physical and peak storage | API-only measurement contract implemented; no connected measurement                     | Heap, index, TOAST and transient-overlap evidence           |
| Private R2 footprint and cost           | Footprint/operation/dated-price contract implemented; no connected measurement          | Object bytes, request volume, retention and cost projection |
| Positive Neon headroom                  | Peak-headroom rule implemented; no connected PostgreSQL 18 result                       | Positive headroom below 536,870,912 bytes                   |

The exported `DNA_OPEN_LAB_CURRENT_P5_READINESS` value is the machine-checkable
counterpart. It keeps every non-satisfied row blocking, keeps owner approval
separate from technical readiness and always reports Production changes as
disallowed.

The recovery harness executes the cases below in a fixed order, one case per
invocation. Its checkpoint is bound to one exact code head and provider scope.
Reports reject more than one API request per case, any real owner-data write,
raw payload or secret evidence, and any synthetic provider residue. A local
synthetic report remains local evidence only; it cannot satisfy connected
private Preview acceptance.

The local adapter layer maps every case to its decisive observable outcome. It
cannot mark a case passed from generic success alone: receipt replay, CAS loss,
retry boundary, reduced allowance, eligibility pause/catch-up, body authority,
pre-staging evidence rejection, atomicity and plan-drift assertions are checked
separately.

The component executor derives those assertions from raw component evidence,
including exact receipt/checkpoint/read-back identities, serving generations,
retry timestamps, commit/staging counters and plan checksums. A component
scenario cannot send a generic passed or recovered flag through this boundary.

## Recovery acceptance cases

Every connected recovery case must record the exact code head, provider scope,
starting last-good generation, cycle/checkpoint revision, immutable evidence
receipts, interruption, retry boundary, catch-up result and final serving
generation. Raw owner payloads and API keys must not enter the report.

| Case                                        | Required outcome                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Crash after R2 write, before checkpoint CAS | Replay returns the original receipt; one checkpoint advancement; no duplicate object        |
| Concurrent checkpoint advancement           | Losing writer fails closed; serving generation unchanged                                    |
| 429 with `Retry-After`                      | No immediate retry; durable retry boundary; last-good remains served                        |
| Lower rate metadata                         | Effective allowance only decreases; aggregate configured ceiling remains 30 requests/minute |
| Eligibility/tier loss                       | Sync pauses and cached site remains usable; no destructive reset                            |
| Eligibility reinstatement                   | Catch-up resumes from durable authority and clears only after complete indexed publication  |
| API outage or invalid body                  | Response-body authority is preserved; partial candidate never publishes                     |
| Missing/conflicting immutable R2 evidence   | Publication fails before Neon staging; last-good remains served                             |
| Neon atomic publication failure             | No serving pointer or receipt-index split; retry is idempotent                              |
| Dynamic ownership/race/Arena plan drift     | Cached receipts are not reused across the changed plan; a full cycle is required            |

## Gate state

- P4 operator infrastructure is implemented and locally synthetic.
- P5 technical evidence is incomplete, so the project is not yet ready to ask
  for first-persistent-sync approval.
- No persistent real owner-data backfill or sync may start.
- The bounded recovery evidence harness is implemented locally.
- The API-only PostgreSQL 18/R2 measurement contract is implemented locally;
  all three capacity rows remain pending connected evidence.
- The generic harness, case-specific assertion adapters and raw
  component-observation executor are implemented; connected acceptance remains
  outstanding.
- The next safe work is the bounded synthetic PostgreSQL 18 measurement runner
  and private R2 footprint collector.
