# Phase 5 Maiden Vault Opportunity Allocation

## Scope

This contract creates a provisional whole-Vault comparison across configured
Maiden brackets. It maximises the total bound, time-led projected value while
enforcing one entitlement per core and each bracket's explicit review capacity.
It is a historical review aid, not a recommendation or entry authority.

## Evidence binding

- Every bracket carries explicit tournament and bracket labels plus
  configuration, candidate-snapshot and projection versions.
- Every candidate must match the bracket's exact tournament, mode and all three
  versions. Version drift and inconsistent ID-to-label mappings fail closed.
- A core's alternatives must share one candidate snapshot and projection
  version. `crossModeEvidenceComplete` records that Bike, Car and Horse were
  considered upstream; incomplete comparisons cannot be allocated.
- Projection basis is fixed to `time_led_chronological`. Strong or competitive
  time evidence is required. Historical stars are retained as supporting
  context and are explicitly never used by the allocator.
- Canonical data cutoffs and accepted-import timestamps are retained. The read
  service replaces stored import and freshness claims with accepted import
  identity and freshness derived from server time.

## Allocation controls

- Allocation is solved across the whole candidate set rather than selecting
  each core greedily in isolation.
- One core may receive at most one provisional allocation.
- Bracket capacity is an explicit input and is never inferred from live-field
  occupancy.
- Preserve-ME, held, stale, incomplete, weak-time, uncertain-bracket and
  unavailable-entitlement candidates are excluded.
- Existing plans, commitments and consumed entitlements are not reallocated.
- Legitimate value ties are preserved and resolved deterministically for
  repeatable review output.
- The value is rendered as an experimental index out of 10,000, not a win
  probability or percentage.
- The plan does not mutate inventory, commit ME or execute an entry. Every
  provisional allocation requires current live-field confirmation and remains
  behind Gates C and D.

## Provenance and deferred composition

The focused prerequisite was recomposed from queue order 17 source head
`c9b0004f7086c8a4fb489690d3465a701312596b` onto verified `main`
`4748f3e21f0eade849fb69d2ceff99ea497c3217`; staged ancestry and the queue
ledger were not merged.

Configured tournament persistence, provider initialization, owner commitment
actions, live-field confirmation and final Gate D activation remain separate
focused slices.
