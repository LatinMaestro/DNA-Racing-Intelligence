# Phase 9 Field-relative Star Validation

## Purpose

Evaluate strong-field star and weak-field eligible no-star associations using
only field-quality features frozen before the event.

## Contract

- Require field-quality and analytical feature cutoffs before the event and the
  outcome record after it.
- Distinguish received, assigned-to-another-core, not-assigned and excluded
  states.
- Treat only `not_received` as an assignment opportunity where another core
  received the signal; a no-assignment event is not negative evidence.
- Exclude all Gold evidence at three gates or fewer without restricting Blue.
- Compare competitive-time outcome rates for received versus not-received
  groups in strong and weak historical fields.
- Keep mode and exact distance separate and require minimum samples on both
  sides of each comparison.
- Exclude partial and invalid observations.

## Boundaries

All rate differences are descriptive associations, not causal effects. The
contract cannot self-accept Gate C, create an actionable recommendation or use
no-star evidence to stop Discovery or recommend burning.
