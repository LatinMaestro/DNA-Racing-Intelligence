# P10 finished-race incremental cycles

Status: A1 persistence and recovery boundary implemented; the first A2
collection/checkpoint slice is implemented. Complete-cycle validation and
last-good generation publication remain the next dependency.

## Purpose

The completed P5 first backfill is immutable historical authority through
2026-09-02. Recurring refreshes must never reset or overwrite its one-row
checkpoint. Migration `0089` therefore adds a separate owner-scoped cycle and
attempt ledger for post-baseline `races_finished` windows.

The first cycle begins at the fixed P5 cutoff
`2026-09-02T00:11:55.961Z`. Each cycle has an immutable lower bound, upper
bound, previous-complete link and deterministic identity. Attempt one must
start with exactly the unprocessed root window and zero counters. A replacement attempt is permitted only after
the immediately preceding attempt is marked superseded, and it must carry the
exact durable checkpoint forward.

## Safety properties

- Completed cycles form an owner-local, gap-free chain: a successor's lower
  bound must equal the prior complete cycle's upper bound.
- Checkpoint counters advance monotonically through compare-and-swap saves.
- Pausing, resuming or superseding cannot alter checkpoint progress.
- Complete and superseded attempts are immutable.
- Completion requires no pending windows and binds the exact checkpoint to a
  stable completion identity. Completion cannot predate the cycle upper bound.
- The exceptional P5 identity-omission authority cannot carry into recurring
  cycles.
- Forced row-level security and function-only runtime privileges preserve owner
  isolation; the Neon adapter re-verifies this boundary in every serializable
  transaction.

Synthetic migration evidence covers create replay, pause/resume, completion,
latest-complete reads, successor chaining, superseded-attempt recovery,
conflict rejection, cross-owner denial and proof that the P5 table is
unchanged. Down/removal evidence cleanly removes only the new additive model.

## A2 collection step

Migration `0090` binds each accepted incremental window receipt to its stable
cycle in the same serializable transaction that advances the cycle checkpoint.
It reuses the immutable R2 window contract while keeping recurring receipts
separate from the one-time P5 ledger. Exact replay returns the already accepted
revision; changed content, changed bounds, skipped windows, arbitrary counter
movement and cross-owner access fail closed.

The server-only incremental runner derives the next lower bound from the latest
complete cycle (or the exact P5 cutoff for the first cycle), resumes the active
attempt, and advances at most one bounded crawler step. A saturated response is
split without hydration. A successful window is hydrated, written through the
idempotent evidence publisher and atomically checkpointed. `Retry-After`, API
eligibility and invalid-response failures pause the same durable checkpoint and
notify the last-good state without discarding it. Superseded attempts resume
from their exact predecessor checkpoint.

Collection completion is only a durable input to the next validation stage.
The runner has no recommendation-generation or last-good publication
dependency, so completing an incremental cycle cannot expose partial data.

## Deliberate boundary

This implementation does not schedule a refresh, call DNA, write hosted R2,
publish a data generation or alter Preview/Production. The next A2 slice will
validate the complete receipt set and compose one all-or-nothing generation
publication while preserving the prior last-good version on every failure.
