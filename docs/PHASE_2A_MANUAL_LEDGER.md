# Phase 2A Manual Ledger Validation Contract

Date: 23 July 2026  
Status: unpublished repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Purpose

This first independent Phase 2A slice defines the validation boundary for
owner-entered economic activity before any private database or form is enabled.

It supports:

- income and expense;
- deposits and withdrawals;
- balanced internal transfers;
- opening balances; and
- auditable adjustments.

The contract produces exact ledger postings. It does not write hosted records,
classify imported races or claim a complete wallet balance.

## Exact asset treatment

Amounts are accepted only as positive plain base-10 decimal strings and remain
exact strings. Binary floating point is never used.

Each entry retains one original asset code and kind. Assets are never combined.
BGC is accepted only as the separate `game_credit` asset and only for:

- actual burn credit;
- arena fee spending;
- opening balance; or
- explicit adjustment.

The owner-confirmed USD 1 = BGC 1 reference is not applied by this validator.
Any equivalent view remains a separate valuation layer.

## Category and direction

Category/subcategory pairs are allowlisted. The category determines posting
direction:

- income and deposits are credits;
- expenses and withdrawals are debits;
- opening balances are credits and adjustments require an explicit credit/debit
  direction;
- internal transfer creates an exact debit from one account and equal credit to
  another account.

Deposits, withdrawals, transfers, opening balances and adjustments are
non-operating. Transfers require distinct source and destination account labels
and cannot enter operating P/L.

## Provenance and completeness

A manual tournament payout requires a tournament link. Core allocation remains
optional because a prize may genuinely be vault-level; an unallocated payout is
accepted with a partial-coverage warning.

A core sale records exact proceeds. Where cost basis is not known, the entry is
accepted with `CORE_SALE_COST_BASIS_MISSING`; realised profit remains
unavailable.

An actual burn BGC credit requires exactly one linked core. The contract does
not predict a burn amount or permit Genesis burn advice.

## Fail-closed validation

The contract rejects:

- blank IDs, timestamps or required account labels;
- invalid timestamps;
- zero, negative, exponential or malformed decimal amounts;
- invalid asset identities or BGC represented as crypto/fiat;
- incompatible category/subcategory pairs;
- same-account or incomplete transfers;
- duplicate linked core IDs;
- tournament payouts without a tournament; and
- burn BGC credits without BGC and exactly one linked core.

## Boundaries

This slice does not:

- persist private economic records;
- store wallet signing credentials, private keys or seed phrases;
- infer completed breeding income from an arena listing;
- duplicate-detect or reconcile against other entries;
- allocate vault-level payouts artificially;
- calculate sale profit without cost basis;
- convert unlike assets; or
- change Preview, Production, provider or Actions state.

Duplicate/reversal controls, database persistence, user forms, filters and the
Vault Performance dashboard remain later focused Phase 2A slices.

## Validation

Synthetic tests cover:

- exact large and fractional decimal values;
- debit and credit direction;
- balanced, non-operating internal transfers;
- non-operating deposits, withdrawals and opening balances;
- separate BGC uses;
- tournament provenance and optional vault-level allocation;
- missing core-sale cost basis;
- deterministic audit metadata; and
- fail-closed amounts, categories, accounts and core links.
