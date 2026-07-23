# Phase 3 Unexpected Outlier Review Contract

## Scope

This slice identifies controlled review candidates where exact-distance time
evidence materially exceeds a versioned prior expectation. It does not confirm
elite quality, enter a race, spend an asset or create a composite rating.

## Evidence rules

- Exact-distance time percentile is the primary outlier evidence.
- An unexpected candidate must clear both an elite threshold and a configured
  gap above the prior expectation.
- Single and repeated elite observations remain distinct.
- Strong-field stars are supporting context only and cannot create an outlier.
- Missing priors remain explicit; they produce an expected-elite review state,
  not a fabricated surprise calculation.

## Fail-closed boundary

Partial or invalid observations, stale evidence and unknown cutoffs are
insufficient. Thresholds are versioned inputs and supporting counts must
reconcile to direct races. Every result remains experimental and non-actionable
until Gate C evidence is complete.

## Validation

Synthetic tests cover unexpected and expected elite candidates, repeated
observations, star-only protection, incomplete and stale evidence, missing prior
expectations, count reconciliation and threshold/runtime validation.
