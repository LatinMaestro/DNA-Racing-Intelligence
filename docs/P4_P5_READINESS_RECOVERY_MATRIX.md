# P4/P5 readiness and recovery matrix

## Authority

This matrix records repository truth for the first persistent real owner-data
sync in a protected private Preview. It does not authorise that sync. Every P5
technical requirement must have exact evidence and the owner must then approve
the first persistent Preview sync explicitly.

Production schema, data, deployment, API secret and game actions remain separate
later approval gates. P5 approval can never authorise Production.

## Current matrix

| P5 technical requirement                | Current evidence                                                                                | Remaining proof                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Restart, replay and idempotency         | Local synthetic CAS checkpoint, immutable R2 first-write and replay-conflict tests              | Connected private Preview restart/replay acceptance     |
| Partial failure and rate-limit recovery | Local synthetic 429, invalid-payload, outage and partial-cycle tests preserve last-good         | Connected private Preview recovery acceptance           |
| Tier loss, reinstatement and catch-up   | Local synthetic eligibility pause and catch-up state tests                                      | Connected private Preview loss/reinstatement acceptance |
| Stale cached website operation          | Local owner-scoped last-good read and pause tests                                               | Protected Preview stale-site acceptance                 |
| PostgreSQL 18 physical and peak storage | Run `33227770750`: PostgreSQL 18, complete owner physical inventory and 3 peak samples          | Satisfied                                               |
| Private R2 footprint and cost           | Run `33227770750`: private bounded footprint, 30-day operation/cost projection and zero residue | Satisfied                                               |
| Positive Neon headroom                  | Run `33227770750`: 17,768,448-byte peak; 519,102,464-byte headroom below 536,870,912            | Satisfied                                               |

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
- Exact-main connected capacity run `33227770750` satisfied all three capacity
  rows. Its artifact digest is
  `sha256:3c9b47aff03ee63554eabf249304fd2f9009c7075c3ba407149ee3dac36823b9`.
  It measured PostgreSQL 18 peak/headroom and the bounded private R2 footprint
  and cost projection, then re-proved cleanup and zero residue.
- The generic harness, case-specific assertion adapters and raw
  component-observation executor are implemented; connected acceptance remains
  outstanding.
- Migrations `0069`–`0076` are applied and smoke-tested on private Preview.
  Exact-main prerequisite run `33224616911` confirms PostgreSQL 18, 15/15
  API-only relations, 13/13 runtime functions, the owner/RLS boundary, private
  R2 access and zero synthetic residue with no blockers.
- The corrected workflow run executed every expected stage on exact head
  `c8e81713ebccf6b781a1d6dc22aa3093ae3ad705`, including intercepted commit,
  rollback, R2 marker verification, footprint collection, cleanup, report build
  and post-run provider safety. Persistent Preview sync and Production remained
  disallowed.
- The next safe work is bounded connected recovery acceptance for the four
  remaining recovery requirements.
