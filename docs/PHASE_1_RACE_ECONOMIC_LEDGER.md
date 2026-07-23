# Phase 1 Race Economic Ledger

Date: 23 July 2026  
Status: implemented with synthetic verification  
Production: disabled and fail-closed

## Scope

Migration 0009 converts owner-confirmed Race Merge economics into exact,
owner-scoped records after a Race Merge dataset has been accepted.

- `rpayout` remains a payout-mechanism label.
- `rfee` becomes a per-entry debit.
- `prize` becomes a per-entry gross payout credit.
- `toke_curr` must resolve to an owner-configured ETH or DEZ asset.
- `r_tags` remains restriction evidence and has no monetary meaning.
- Zero amounts create no ledger noise.
- Blank, malformed, negative or over-precision amounts become review-required.
- BGC cannot enter race-derived transactions.

The generic `unclassified` ledger category is retained until race-format-specific
tournament/open classification is independently validated. The source-confirmed
subcategories `race_entry_fee` and `race_prize` preserve the reliable meaning.

## Daily USD valuation

Daily rates are immutable per owner, asset and UTC date. CoinGecko identifiers are
pinned to Ethereum and the confirmed Polygon DEZ contract. A manual rate is allowed
only as an explicit `manual_override` with its own provenance.

Valuation joins on the transaction asset and the race timestamp's UTC date. It uses
the configured asset atomic scale and PostgreSQL exact numerics. Missing rates stay
`unavailable`; there is no latest-price fallback, interpolation or page-time API
call.

## Storage and privacy

Neon stores the compact rate, transaction and valuation records. Detailed private
source history remains assigned to private R2/Parquet. Both new tables use forced
owner row-level security, public table/function access is revoked and the coverage
view executes with caller permissions.

## Verification

The synthetic PostgreSQL 16 smoke test proves:

- exact DEZ and ETH atomic amounts;
- debit/credit signs and zero omission;
- separate payout-mechanism and race-tag persistence;
- invalid-row reconciliation and replay idempotence;
- immutable rate conflict rejection;
- exact converted USD amounts and explicit missing-rate coverage;
- BGC exclusion, forced RLS and revoked public execution;
- complete migration reversal before earlier migrations are removed.
