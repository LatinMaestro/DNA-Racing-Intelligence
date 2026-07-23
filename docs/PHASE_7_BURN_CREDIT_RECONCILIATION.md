# Phase 7 Burn-Credit Reconciliation

## Purpose

Link an actual BGC credit to a separately confirmed burn without predicting the
credit or treating lifecycle advice as economic evidence.

## Contract

- Require a confirmed burn event before proposing a ledger posting.
- Accept only exact positive BGC evidence from a manual or authoritative source.
- Match automatically only when one confirmed credit explicitly references the
  same burn and core and does not predate the burn.
- Keep core/date candidates, mismatches, provisional evidence and multiple
  direct credits in review.
- Never auto-exclude a possible duplicate.

## Boundaries

The contract does not burn a core, estimate a BGC return, mutate the burn event
or post a hosted ledger entry. It only proposes one actual credit for review
when the evidence is unambiguous.
