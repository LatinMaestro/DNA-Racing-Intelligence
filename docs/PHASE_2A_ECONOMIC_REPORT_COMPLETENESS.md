# Phase 2A Asset-Separated Reporting and Completeness Contract

Date: 23 July 2026  
Status: unpublished repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Purpose

This Phase 2A slice defines how a Vault Performance report aggregates exact
ledger records and discloses whether the result is complete, partial or
estimated.

The contract prevents three unsafe claims:

- combining unlike assets into one unsupported total;
- including transfers or other non-operating movements in activity P/L; and
- describing recorded activity as complete lifetime profit.

## Exact asset-separated totals

Included records are grouped by exact normalized asset code and asset kind.
Each group reports:

- income;
- expense;
- net movement; and
- included transaction count.

All arithmetic uses decimal strings and `BigInt`; no binary floating point is
used.

ETH, DEZ, fiat and any later supported assets remain separate.
`combinedAssetTotalAvailable` is always false in this contract because a dated
conversion layer is not part of the original-asset total.

## BGC separation

BGC must be represented as `game_credit`. It is returned through a separate BGC
totals collection and never enters cash/crypto totals.

The owner-confirmed USD 1 = BGC 1 reference is not applied silently. A future
separately labelled equivalent view may use it without altering original BGC
movement.

## Scope-aware aggregation

For `activity_cashflow`, only operating records are included. Deposits,
withdrawals, internal transfers, opening balances and reconciliation movements
therefore remain outside operating P/L.

Other scopes may include:

- wallet-balance reconciliation;
- core trading; and
- BGC movement, which admits only the separate game-credit records.

Excluded or confirmed-duplicate records do not enter totals, but their count
remains visible.

## Completeness status

`partial` takes precedence when any required evidence is incomplete:

- source coverage does not span the requested period;
- data-current-through or last-imported time is unknown;
- activity remains unclassified;
- reconciliation issues remain unresolved;
- manual external-payout coverage is unknown;
- a core-trading report lacks cost basis;
- a wallet-balance report lacks an opening balance; or
- a requested conversion lacks rates.

`estimated` is used only when coverage is otherwise complete and an explicitly
requested converted view uses estimated rates.

`complete` means the stated report scope and period satisfy all listed evidence
checks. It never authorizes a complete lifetime-profit claim;
`lifetimeProfitClaimAllowed` remains false.

## Freshness and provenance

The result retains:

- requested period;
- data current through; and
- last imported.

These timestamps describe imported historical coverage. The contract does not
imply live game, wallet or arena data.

## Fail-closed validation

The contract rejects:

- unsupported runtime scope, asset-kind, aggregate-state or conversion values;
- invalid periods and timestamps;
- negative, fractional or unsafe issue counts;
- duplicate transaction IDs;
- malformed or zero exact amounts;
- invalid asset identities; and
- BGC represented outside the separate game-credit kind.

## Boundaries

This slice does not:

- persist private economic data;
- supply missing opening balances, cost basis or payout evidence;
- create a combined cross-asset total;
- fetch or apply historical conversion rates;
- value BGC or unsold cores as realised cash;
- classify tournament stages;
- initiate wallet or game transactions; or
- change Preview, Production, providers or GitHub Actions.

Database-backed reports, filters, campaign/core attribution and the private
dashboard remain later focused Phase 2A slices.

## Synthetic validation

Tests cover exact multi-asset arithmetic, BGC separation, operating exclusions,
reconciliation exclusions, period filtering, scope-aware coverage, conversion
status, missing cost basis, missing opening balance and fail-closed runtime
boundaries.
