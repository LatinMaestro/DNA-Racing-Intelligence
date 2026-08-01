# Phase 7 Lifecycle Action Ranking

## Purpose

Compare race, Discovery, reserve-Maiden, breed, hold, sell and burn alternatives
from already-audited evidence without turning strategic review into an execution
instruction.

## Evidence and version contract

- Bind configuration, candidate, racing, Discovery, Maiden, breeding, lineage
  and market snapshot versions at ranking and core level. Version drift holds
  every action.
- Keep racing, Discovery, Maiden, breeding, lineage and market evidence
  explicit. Any unresolved value, partial coverage, stale data or protection
  review holds every action rather than becoming negative evidence.
- Require every action exactly once with explicit reasons and a bounded integer
  score. Preserve tied ranks and return insufficient evidence for a tied lead.
- Require credible racing evidence for race review, confirmed ME for reserve
  review, a promising hypothesis for Discovery, supported breeding value for
  breed review and confirmed market evidence for sale review.

## Burn and accounting boundaries

- Apply the confirmed `canBurn` game rule: Genesis can never enter burn review.
- Eligible no-star and Gold-ineligible evidence never establish a burn case.
  Burn requires both an explicit independent non-star-negative attestation and
  a settled negative racing, breeding or lineage state.
- Do not accept predicted burn credit or BGC into ranking.
- Missing cost basis remains explicit. Sale proceeds cannot be described as
  profit and sale profit does not enter the ranking.

Sell and burn are strategic review labels only. The ranking cannot issue a
final recommendation, enter a race, change Maiden state, breed, list, sell or
burn a core, use a wallet, record BGC or post a ledger transaction.

## Source identity

This prerequisite was recomposed with queue order 19 from exact source head
`8ce3661b6392dd8dc23f0be207d1c75be892c1ee` onto verified `main`
`05da45d1f0e581e840b77607154f6299c5aee3cd`. No staged precursor, queue ledger,
rehearsal branch or cumulative descendant was merged.
