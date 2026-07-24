# Phase 5 Maiden Cross-Mode Comparison

## Scope

This contract compares one Maiden-eligible core across Bike, Car and Horse using
a configured, versioned time-led projection score. It preserves the projected
distance, leaderboard objective, expected tournament structure, evidence
strength, freshness and scarcity of alternative eligible cores.

## Controls

- All three modes require credible evidence before a strongest mode is named.
- A configured material gap is required; ties and immaterial differences remain
  unresolved.
- Weak time, incomplete structure, low confidence, stale evidence or missing
  cutoffs prevent a strongest-mode conclusion.
- Historical Gold/Blue evidence is supporting rationale only and never changes
  the projection score or rank.
- A weaker active Maiden is labelled `preserve ME`.
- If the strongest mode has no active Maiden, the result waits rather than using
  the first available weaker tournament.
- Alternative-core scarcity is disclosed but cannot manufacture a stronger
  projection.
- Every result remains non-actionable behind Gates C and D.

## Deferred composition

The upstream calibrated projection model, tournament UI, owner commitment action
and lifecycle persistence remain separate gated slices.
