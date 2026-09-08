# P10 finished-race incremental cycles

Status: A1 persistence and recovery boundary implemented; A2 orchestration is
the next dependency.

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

## Deliberate boundary

This change does not schedule a refresh, call DNA, write R2, publish a data
generation or alter Preview/Production. A2 will compose this ledger with the
existing bounded crawler, immutable evidence sink, validation, generation
publication and last-good serving controls.
