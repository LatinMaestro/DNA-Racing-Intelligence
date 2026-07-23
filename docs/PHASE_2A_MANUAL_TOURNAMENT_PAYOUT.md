# Phase 2A Manual Tournament Payout

## Scope

This slice defines validation and allocation for a game-owner tournament prize
recorded manually because it may not appear in Race Merge history. It creates no
wallet transaction and does not persist private evidence.

## Allocation methods

The payout may:

- remain unallocated at tournament/vault level;
- be attributed entirely to one core;
- be divided equally;
- use exact manually entered amounts;
- use exact percentages totalling 100; or
- use a documented positive-integer points method.

Explicit allocations must reconcile exactly to the original payout amount at the
configured asset precision. Equal, percentage and points splits use deterministic
largest-remainder apportionment, with core ID as the tie-break. No binary
floating-point arithmetic is used.

## Accounting boundaries

- The source is always `manual_tournament_payout`.
- The amount is positive operating income in its original crypto or fiat asset.
- BGC is rejected because it belongs to the separate game-credit ledger.
- A vault-level prize does not require artificial per-core attribution.
- Every manual payout remains subject to duplicate/reconciliation review against
  imported and other manual evidence.

## Deferred work

Persistence, private forms, evidence attachments, duplicate resolution and
tournament UI composition remain later focused slices. Full exact-head CI is
required before merge.
