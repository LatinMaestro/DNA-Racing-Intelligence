# Phase 6 Breeding Fee Calculator

## Scope

This contract calculates one proposed pairing's confirmed base and Arena fee
components using exact decimal arithmetic. It preserves each source component,
asset, historical cutoff, import time and listing expiry.

## Controls

- BGC and USD remain separate totals and are never silently combined.
- The owner-confirmed USD 1 = BGC 1 reference is exposed only as a reference
  equivalent for the BGC total; it is not cash income or a conversion event.
- Unknown, unavailable, ageing, stale or expired fee evidence fails closed.
- Arena components require an exact listing ID and expiry timestamp.
- Manual base rules cannot carry Arena listing provenance.
- Exact amounts allow up to 18 decimal places and never use floating point.
- `Data current through`, `Last imported` and listing expiry remain separate.
- Every result requires live confirmation and cannot recommend or execute a
  breeding transaction before Gate E.

## Deferred composition

Arena scanning, pair ranking, actual ledger entries, cost-basis assignment,
persistence, UI composition and Gate E validation remain separate slices.
