# Phase 6 Breeding Arena Scanner

## Scope

This contract scans the one selected, accepted Current Arena snapshot and
projects historically available breeding candidates using exact source-core
identity, exact USD price, supplied splice capacity and listing expiry.

## Controls

- Quarantined, rolled-back or merely newer attempts never replace the selected
  accepted snapshot.
- More than one selected accepted snapshot is invalid.
- Identity links require the exact authoritative source core ID; unmatched or
  ambiguous rows remain review-required.
- Exact USD price, remaining splice count and expiry are preserved separately.
- `Data current through`, `Last imported` and evaluation time remain separate.
- Ageing, stale, expired or incomplete evidence fails closed.
- Every candidate is labelled as a historical snapshot and requires live
  confirmation.
- Arena listings never create completed breeding, income or operating P/L.
- The scanner cannot rank pairings or recommend breeding before Gate E.

## Deferred composition

Family filtering, fee composition, predictive research, pair ranking,
persistence, UI composition, actual ledger entries and Gate E validation remain
separate slices.
