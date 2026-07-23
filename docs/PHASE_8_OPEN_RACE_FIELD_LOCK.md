# Phase 8 Open Race Field Lock

## Purpose

Transition a manually entered Open Race from forming-field selection to the
locked, about-to-run observation stage without rewriting the committed decision.

## Contract

- Require a complete unique entered-core set equal to the gate count.
- Require zero available gates, explicit user confirmation and confirmation that
  the game has set the race to run.
- Preserve the field capture, pre-entry ranking and lock timestamps in order.
- Preserve both the provisional leader and the core the user actually committed.
- Permit the preserved provisional leader to remain outside the locked field when
  the user commits a different alternative.
- Permit an insufficient-evidence commitment without inventing a pre-entry
  leader.
- Surface a warning when the committed core differs from the provisional leader.

## Boundaries

The transition captures no current-race stars or race outcomes. Once locked, the
entry is immutable: the contract cannot switch cores, recommend a replacement or
enter the race. It only permits the separate optional observation workflow.
