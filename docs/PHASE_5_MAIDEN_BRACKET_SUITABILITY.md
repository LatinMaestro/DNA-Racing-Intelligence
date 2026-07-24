# Phase 5 Maiden Bracket Suitability

## Scope

This contract reviews one core against one configured Maiden bracket after the
cross-mode comparison. It evaluates the bracket's actual distances,
leaderboard objective, eligibility, structure, lifecycle state, evidence
confidence and freshness.

## Controls

- Every configured distance remains separate and requires sufficient time-led
  evidence plus fit to the configured leaderboard metric.
- Missing, limited, weak or unknown evidence holds the candidate.
- Historical Gold/Blue evidence is supporting context only and cannot override
  weak time or metric fit.
- A weaker-mode bracket is labelled `preserve ME`.
- Unresolved cross-mode comparison, incomplete tournament structure, stale data,
  unresolved eligibility and low confidence all fail closed.
- Planned or committed entitlements retain their exact tournament identity;
  commitments elsewhere cannot be redirected.
- Closed, ineligible and consumed states remain distinct.
- Even a fully supported strongest-mode bracket is only a review candidate. It
  cannot commit or execute an entry before Gates C and D.

## Deferred composition

Tournament persistence, live-field confirmation, owner commitment UI and final
Gate D evidence remain separate focused slices.
