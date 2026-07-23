# Phase 2A Vault Performance Summary

## Scope

This slice defines the deterministic vault-wide reporting contract over accepted
economic ledger records. It does not persist records, connect a wallet, value
unsold cores, combine unlike assets or enable Production.

## Guarantees

- Each asset is aggregated independently using exact decimal arithmetic.
- BGC is accepted only as the separate `game_credit` asset and remains outside
  cash/crypto totals.
- Open racing, qualification, later tournament stages, manual tournament
  prizes, breeding, core trading and lifecycle activity remain distinct.
- Deposits, withdrawals, internal transfers, opening balances and
  reconciliation adjustments are non-operating movements.
- Excluded records retain their audit status but do not enter totals.
- A realised core-trading result is unavailable when a sale lacks known
  same-asset cost-basis evidence.
- No combined-asset or lifetime-profit total is exposed.

## Completeness and freshness

The result remains partial when any of the following applies:

- source coverage is incomplete or unknown;
- manual tournament-payout coverage is unknown;
- activity is inferred or unclassified;
- reconciliation is unresolved;
- a core sale lacks same-asset cost basis;
- data-current-through or import time is unknown; or
- the imported snapshot is ageing, stale or of unknown freshness.

The report exposes `Data current through`, `Last imported` and freshness
separately. Freshness warnings do not change accepted historical facts.

## Deferred work

Persistence, private forms, dashboard composition, conversion views and provider
integration remain later focused slices. Full exact-head CI remains mandatory
before merge.
