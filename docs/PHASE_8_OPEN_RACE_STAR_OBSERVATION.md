# Phase 8 Open Race Star Observation

## Purpose

Optionally preserve the Gold and Blue assignments revealed after field lock as a
manual pre-run observation.

## Contract

- Require the locked observation stage and a complete immutable entered field.
- Preserve assigned, not assigned and not observed states separately.
- Preserve Gold not applicable separately for races with three gates or fewer.
- Permit the same core to receive both stars.
- Require every assigned star core to be present in the locked field.
- Preserve an ineligible Gold claim as a review anomaly rather than silently
  rewriting it.
- Mark the observation pending reconciliation with a later authoritative Race
  Merge import.

## Boundaries

The record is observational only. It is not permanent historical evidence, a
completed result or a prediction success. It cannot contain finishing, payout or
other outcome data and cannot issue a replacement-core recommendation.
