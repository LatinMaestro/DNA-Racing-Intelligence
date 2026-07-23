# Phase 5 Maiden Vault Opportunity Allocation

## Scope

This contract creates a provisional whole-vault allocation across configured
Maiden brackets. It maximises the total configured projected value while
enforcing one entitlement per core and each bracket's explicit review capacity.

## Controls

- Allocation is solved across the whole candidate set rather than selecting
  each core greedily in isolation.
- One core may receive at most one provisional allocation.
- Bracket capacity is an explicit input and is never inferred from live field
  occupancy.
- `preserve ME`, held, stale, incomplete, uncertain-bracket and unavailable
  entitlement candidates are excluded.
- Existing plans, commitments and consumed entitlements are not reallocated.
- Legitimate value ties are preserved and resolved deterministically for
  repeatable review output.
- Candidate scores are versioned upstream time-led projections; this contract
  does not add star evidence to them.
- The plan does not mutate inventory, commit ME or execute an entry. Every
  provisional allocation requires live-field confirmation and remains behind
  Gates C and D.

## Deferred composition

Configured tournament persistence, owner review UI, live-field confirmation,
commitment actions and final Gate D activation remain separate focused slices.
