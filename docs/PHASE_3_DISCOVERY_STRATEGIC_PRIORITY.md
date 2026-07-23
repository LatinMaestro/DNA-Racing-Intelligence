# Phase 3 Discovery Strategic Priority

This contract orders review of exact-distance Discovery evidence for configured
tournaments and Maiden preservation without issuing an entry recommendation.

## Boundaries

- A provisional ME mode requires credible evidence across Bike, Car and Horse.
- The strongest credible mode must clear a versioned gap; close modes remain
  unresolved.
- An available Maiden in a weaker mode is labelled `preserve ME`.
- A Maiden in the provisional strongest mode remains a review candidate behind
  Gate D and cannot commit ME.
- Tournament relevance changes review priority only. It does not replace the
  configured leaderboard objective or authorise race entry.
- Closed tournaments are excluded from active context.
- Data cutoff and import completion remain separate, ordered timestamps.
- Partial, low-confidence, stale or unknown evidence cannot support the
  cross-mode comparison.
- All outputs remain experimental and non-actionable until Gate C; final Maiden
  entry remains disabled until Gate D.

## Verification

Synthetic tests cover three-mode comparison, weaker-Maiden preservation,
strongest-mode gating, incomplete and close comparisons, tournament relevance,
stale evidence, inconsistent ME state, tournament mode integrity, exact cell
uniqueness and versioned thresholds.
