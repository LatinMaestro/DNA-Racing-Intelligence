# Phase 9 Open Race Holdout Evaluation

## Purpose

Evaluate the frozen pre-entry Open Race decision against a distinct simple
baseline on chronological holdout cases without using information revealed
after the decision.

## Contract

- Require feature and imported-data cutoffs at or before the pre-entry decision.
- Require the decision to precede field lock and the authoritative outcome.
- Structurally require current-race stars to be unavailable at decision time.
- Compare competitive-outcome rate, best-eligible-core selection and elapsed-time
  regret with a separately versioned baseline.
- Keep Bike, Car and Horse and every exact distance in separate cells.
- Exclude partial or invalid outcome evidence and disclose stale historical
  inputs.
- Preserve avoid-signal accuracy as a separate diagnostic.

## Boundaries

Synthetic evidence is non-dispositive. The report cannot self-accept Gate C,
enable an actionable recommendation, rerank a locked field or claim that a
post-lock star was available during selection.
