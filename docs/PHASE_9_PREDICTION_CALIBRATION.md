# Phase 9 Prediction Calibration

## Purpose

Evaluate probability-producing analytical models against a simple baseline on
the identical chronological holdout cases without allowing synthetic evidence
to establish Gate C performance.

## Contract

- Require one candidate and one baseline prediction for every holdout case.
- Require each prediction to predate its observed outcome.
- Preserve historical-holdout and synthetic-fixture evidence separately.
- Calculate Brier score and calibration error with integer basis-point
  arithmetic.
- Report fixed probability bins with case count, mean prediction, observed rate
  and absolute calibration error.
- Compare candidate and baseline Brier scores with lower treated as better.
- Disclose real and synthetic case counts and the declared minimum real sample.

## Boundary

The contract reports evidence only. A favourable synthetic or real result does
not self-accept Gate C, authorise a recommendation or establish causal,
inherited-trait or production-ready performance.
