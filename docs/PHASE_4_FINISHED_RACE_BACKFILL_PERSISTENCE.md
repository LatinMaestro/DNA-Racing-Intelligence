# Phase 4 Finished-Race Backfill Persistence

## Scope

Migration `0070_dna_open_lab_finished_race_backfill` makes the existing bounded
finished-race crawler restartable through compact owner-scoped Neon state while
keeping full API evidence in private R2.

The slice persists:

- one versioned compare-and-swap checkpoint per owner;
- the bounded pending-window stack and progress counters already defined by the
  keyless P2 crawler; and
- one immutable receipt per accepted finished-race window, including the window,
  content checksum, document count, private manifest object key, manifest checksum
  and manifest byte length.

No raw API payload is stored in Neon.

## Atomic receipt binding

There are two legal checkpoint transitions:

1. a saturated window is replaced by its two deterministic child windows; or
2. a non-saturated window is removed only while its verified R2 publication
   receipt is inserted in the same serializable transaction.

The database rejects a completed-window counter advance without a receipt. It also
rejects revision drift, changed root authority, invalid split geometry, counter
drift, receipt conflicts and window/receipt mismatch.

An uncertain client response can replay the same transition idempotently. Different
content for an existing window key fails closed.

## Security and recovery boundary

- Both tables use forced owner RLS.
- The runtime role has no direct table privilege.
- Narrow security-definer functions provide checkpoint save/read and receipt read.
- The repository verifies forced RLS, function grants and the least-privilege
  runtime role before each serializable operation.
- R2 publication remains private, owner-scoped and checksum-verified before its
  receipt can reach the checkpoint repository.
- A non-saturated source row without authoritative stable `rid` is written to
  private immutable R2 quarantine before the backfill fails. Its opaque locator
  is derived from window, source ordinal and raw checksum; it is explicitly
  marked non-canonical and non-last-good and is never substituted for DNA race
  identity.
- By default, an identity-conflicted window cannot hydrate documents, publish a
  window manifest or advance its checkpoint. Exact retry reuses the same
  immutable quarantine object.
- The sole exception is exact measurement-bound omission authority capped at
  25 observations. The checkpoint persists its measurement-evidence checksum,
  maximum and cumulative omitted count. Only identified races are hydrated;
  every quarantine receipt is verified and bound into the version-2 window
  manifest; checkpoint and receipt advance atomically. Authority drift or a
  cumulative bound breach fails closed.
- Durable receipts can be read later for P5 replay/recovery verification without
  exposing raw evidence.

## Evidence boundary

All tests and migration smoke checks use deterministic synthetic windows, hashes,
object keys and counts. This slice performs no connected DNA Open Lab call, hosted
Neon migration, real R2 write, persistent API backfill or Vercel deployment.

The first persistent real Preview sync remains blocked until the exact bounded
P5 owner approval is recorded. The quarantine boundary preserves omitted source
evidence for review and never converts it into a race identity.

## Deferred P4 work

- canonical API read-model tables for proven current facts;
- current-state generation materialization;
- worker scheduling and family cadences; and
- storage/capacity/recovery measurement for the P5 gate.
