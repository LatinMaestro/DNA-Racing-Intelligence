# Phase 3 Discovery Probe Planning Contract

## Scope

This slice creates a deterministic review queue for exact core × mode ×
distance evidence gaps. It does not predict core quality, enter a race, spend an
asset, stop Discovery or consume Maiden eligibility.

## Planning rules

- Ten exact-distance races remains a minimum evidence boundary, not proof.
- Bike, Car and Horse remain separate at every exact distance.
- Direct results remain primary; resolved lineage may identify a hypothesis but
  cannot substitute for direct observations.
- Tournament relevance and Maiden eligibility may raise review priority, but
  cannot authorise an entry.
- Stale data, unknown cutoffs and unresolved Maiden state are deferred.
- Maiden-eligible candidates carry an explicit commitment-review warning.

## Gate boundary

Every output is experimental and non-actionable. Automatic entry and automatic
stop remain disabled until Gate C holdout, baseline and calibration evidence
passes. The output describes coverage work for review, not a racing instruction.

## Validation

Synthetic tests cover deterministic ordering, exact-distance separation, the
10-race boundary, Maiden preservation, stale and unresolved evidence,
lineage-resolution controls, runtime enum validation and duplicate rejection.
