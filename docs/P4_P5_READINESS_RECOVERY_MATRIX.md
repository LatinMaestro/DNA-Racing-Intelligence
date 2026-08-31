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

Recurring commissioning now targets one complete refresh per day. The
30-request/minute ceiling controls burst rate only. A pre-write zero-cost gate
caps R2 at 8 GB, 800,000 Class A and 8,000,000 Class B operations per billing
window and pauses on last-good data before paid usage. The first historical
backfill remains a separate explicitly cost-bounded owner approval within P5.

The local adapter layer maps every case to its decisive observable outcome. It
cannot mark a case passed from generic success alone: receipt replay, CAS loss,
retry boundary, reduced allowance, eligibility pause/catch-up, body authority,
pre-staging evidence rejection, atomicity and plan-drift assertions are checked
separately.

The component executor derives those assertions from raw component evidence,
including exact receipt/checkpoint/read-back identities, serving generations,
retry timestamps, commit/staging counters and plan checksums. A component
scenario cannot send a generic passed or recovered flag through this boundary.

The connected invocation boundary now binds every private Preview case to the
expected and actual exact code head. It emits only a hash-addressed whitelist
record containing the case identifier, bounded counts, pass state and
checkpoint/report hashes. Provider configuration, owner and object identities,
payloads, summaries and provider errors cannot cross the emission boundary.
Only the tenth complete passing report can mark connected recovery evidence
complete; even then, persistent Preview sync and Production remain disallowed.

The guarded provider lifecycle buffers that sanitized record until the case has
finished, mandatory cleanup succeeds and a second provider inspection proves
that owner data, acquisition checkpoints, last-good serving state and retained
evidence exactly match their pre-case fingerprints with zero synthetic residue.
Scenario, cleanup, inspection or emission failure is redacted and fails closed.
The provider safety layer now supplies those fingerprints from a fixed
least-privilege Neon relation inventory and the private hashed-owner R2 prefix.
Migration `0077` exposes only the compact four-group fingerprint result to the
runtime role and preserves the direct-table-read prohibition.
The R2 cleanup port can remove only objects below `p5-recovery/`, is capped at
10,000 objects, and must prove that prefix empty afterward; retained evidence is
never included in the deletion set.

The first crash/restart case is now component-bound. It uses the production
bounded acquisition runner with a deliberately interrupted synthetic checkpoint
and the production immutable evidence format, but redirects the probe through
an exact-authority factory to
`p5-recovery/crash-after-evidence-write/`. Replay must return the first receipt,
read-back must verify the stored bytes, the checkpoint may advance exactly once
and provider cleanup must restore all protected fingerprints with zero residue.
The scenario performs no DNA API request and cannot write a Neon owner row.

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
  component-observation executor are implemented. The exact-head connected
  invocation, sanitized evidence boundary and mandatory provider-state cleanup
  lifecycle are also implemented. Concrete bounded Neon/R2 safety inspection
  and temporary R2 cleanup ports are implemented. The first provider-backed
  crash/restart scenario is implemented; its private Preview execution and the
  remaining provider-backed cases remain outstanding.
- Migrations `0069`–`0076` are applied and smoke-tested on private Preview.
  Exact-main prerequisite run `33224616911` confirms PostgreSQL 18, 15/15
  API-only relations, 13/13 runtime functions, the owner/RLS boundary, private
  R2 access and zero synthetic residue with no blockers.
- The corrected workflow run executed every expected stage on exact head
  `c8e81713ebccf6b781a1d6dc22aa3093ae3ad705`, including intercepted commit,
  rollback, R2 marker verification, footprint collection, cleanup, report build
  and post-run provider safety. Persistent Preview sync and Production remained
  disallowed.
- The guarded exact-head workflow binding for the first
  crash-after-R2-write/restart-replay scenario is implemented. Its private
  Preview execution is the next acceptance step, followed by the remaining
  ordered connected cases.
- The second connected case now has a component-backed concurrency scenario:
  two workers replay one immutable temporary R2 receipt from the same synthetic
  checkpoint revision, exactly one compare-and-swap advances, the losing writer
  is rejected, last-good serving remains unchanged and cleanup leaves no R2
  residue. It does not write a Neon checkpoint or persistent owner row.
- The third connected case now drives a synthetic 429 through the production
  acquisition runner. The durable checkpoint blocks a request one second before
  Retry-After, resumes at the exact boundary, verifies the successful immutable
  temporary R2 receipt, completes catch-up and restores zero provider residue
  without publishing or writing persistent owner data.
- The fourth connected case now drives lower response rate metadata through the
  production client pool. An advertised higher allowance cannot raise the
  conservative 30-request aggregate ceiling; an observed 12-request allowance
  reduces both lane and aggregate gates, and the next excess request waits for
  the following minute. Temporary evidence is read back and cleaned without
  changing checkpoints, owner rows or last-good serving.
- The fifth connected case now drives synthetic TierBadge loss through the
  production acquisition runner and last-good state transition. It records an
  `api_ineligible` pause without a retry boundary, leaves the durable accepted
  generation and cached serving pointer intact, records catch-up as pending
  rather than falsely complete, and cleans its one temporary immutable R2
  marker without changing provider fingerprints.
