# Phase 7 Lifecycle Action Ranking

## Purpose

Compare the approved race, discover, reserve-Maiden, breed, hold, sell and burn
alternatives from already-audited evidence without turning strategic advice into
an execution instruction.

## Contract

- Require explicit evidence and a bounded integer score for every action.
- Preserve tied scores and return insufficient evidence instead of selecting an
  arbitrary winner.
- Hold all actions when freshness, coverage or protection evidence is unresolved.
- Require confirmed ME for reserve-Maiden, a viable hypothesis for Discovery and
  confirmed market evidence for sale review.
- Permanently prohibit Genesis burn.
- Require independent non-star negative evidence before burn can even enter the
  strategic review ranking.
- Keep sell and burn labelled as strategic review only.

## Boundaries

The ranking cannot issue a final actionable recommendation before the applicable
analytical gates. It cannot enter a race, change ME, list or sell a core, burn a
core, use predicted burn credit, record BGC or post any ledger transaction.
