# Phase 6 Breeding Lift Evaluation

## Purpose

Evaluate whether parent and lineage star features add chronological predictive
value beyond both time-only and lineage baselines.

## Contract

- Generate predictions no later than breeding and use only features whose cutoff
  predates breeding.
- Evaluate outcomes only after breeding.
- Use authoritative outcome IDs once.
- Evaluate all three models on the same complete-star holdout rows.
- Keep Bike, Car and Horse and every exact distance separate.
- Report Brier score, mean predicted rate, observed rate and calibration error.
- Require both configured sample size and minimum improvement over both
  baselines before marking a cell as a Gate E review candidate.
- Keep training rows and incomplete star evidence visible as exclusions.

## Boundaries

Synthetic evidence cannot pass Gate E. A supported candidate remains a review
result, not proof of inherited star propensity, an exceptional-offspring claim or
a pairing recommendation.
