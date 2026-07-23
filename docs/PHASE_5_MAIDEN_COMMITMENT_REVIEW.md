# Phase 5 Maiden Commitment Review

## Scope

This contract creates the mandatory review immediately before any future
owner-confirmed Maiden commitment. It combines lifecycle state, strongest-mode
comparison, bracket suitability, tournament structure, eligibility,
confidence and freshness without changing the entitlement.

## Controls

- Every review displays that Maiden entitlement is single-use.
- A commitment reserves one exact tournament but does not itself record
  participation or consumption.
- Weaker-mode opportunities remain `preserve ME`.
- Unresolved cross-mode evidence, incomplete bracket evidence, stale imports,
  low confidence or unknown eligibility hold the review.
- Existing plans and commitments retain their tournament identity and cannot be
  redirected.
- Consumed, ineligible and closed states remain distinct.
- `Data current through`, `Last imported` and freshness remain separately
  visible.
- The contract cannot mutate lifecycle state, commit ME or execute an entry.
  It remains behind Gates C and D.

## Deferred composition

Owner acknowledgement UI, authenticated persistence, authoritative
participation reconciliation and final Gate D activation remain separate
focused slices after exact-head CI.
