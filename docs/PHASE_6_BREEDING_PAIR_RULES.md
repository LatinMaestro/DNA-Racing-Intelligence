# Phase 6 Breeding Pair Rules

## Scope

This first Phase 6 contract evaluates one proposed pairing against confirmed
family restrictions and supplied parent availability, splice-capacity and
breeding-cycle evidence. It also derives the confirmed offspring class,
element and F-number outcomes.

## Controls

- Parent, grandparent and full-sibling pairings are ineligible.
- Half siblings, distant descendants and other relationships remain allowed
  where lineage is complete.
- Missing, duplicated, inconsistent or cyclic lineage remains review-required.
- Selected parent class must match authoritative lineage evidence.
- Splice capacity is supplied as available, exhausted or unknown with the
  remaining count. The contract does not invent a global maximum.
- Breeding cycle is supplied as ready, cooldown or unknown. A cooldown requires
  a future next-eligible timestamp.
- Inactive, unavailable, exhausted or cooling-down parents remain temporarily
  unavailable; unknown or stale evidence fails closed.
- Offspring class uses the confirmed class matrix, element uses the lower-ranked
  parent element and F-number is the parent sum with no cap.
- This rule evaluation predicts no offspring quality, treats no star signal as
  inherited, and cannot recommend or execute breeding before Gate E.

## Deferred composition

Fee calculation, arena freshness, probabilistic offspring research, ranking,
ledger integration, persistence and Gate E validation remain separate focused
slices.
