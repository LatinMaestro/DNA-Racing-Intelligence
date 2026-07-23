# Phase 1 Race Economics Storage

Date: 23 July 2026  
Status: repository migration and synthetic PostgreSQL verification  
Production: disabled and fail-closed

## Scope

Migration `0009_race_economics_storage` persists owner-scoped race fees,
payouts, daily USD rates and exact historical valuations. It does not connect to
Neon, fetch a live rate, upload private data, enable Production or select a paid
provider plan.

## Ownership boundary

Race Merge contains every gate participant. A row may create a personal
economic transaction only when its core is linked to the current Vault snapshot
through a confirmed identity review. A unique name candidate is not treated as
ownership until that review is confirmed.

Rows for other racers continue to support race and performance analysis but
cannot enter the owner's P/L ledger.

## Exact token accounting

The accepted worker writes normalized non-negative `rfee` and `prize`
amounts, ETH or DEZ, the `rpayout` mechanism and raw `r_tags` into the
owner-scoped normalized Race Merge fact.

The database:

- creates no transaction for a numeric zero;
- converts a positive fee to an exact negative atomic-unit debit;
- converts a positive prize to an exact positive atomic-unit credit;
- requires an explicitly provisioned asset scale and rejects excess precision;
- uses the same stable natural key as the TypeScript domain contract;
- preserves batch, source-row, payout-mechanism and race-tag provenance; and
- quarantines a natural-key value conflict rather than rewriting accepted
  history.

ETH and DEZ asset scales must come from authoritative asset metadata before
materialization. The migration does not guess or silently round a scale.

The broad accounting category remains `unclassified` with
`review_required` classification until the payout mechanism and tournament
stage rules have their own verified mapping. Entry fee versus payout remains
exact in the contribution record.

## Daily USD rates

Every rate is owner-scoped and records:

- asset and UTC date;
- exact USD per asset;
- provider and pinned series identity;
- source and retrieval timestamps;
- available or manual-override status;
- the superseded rate; and
- whether it is current.

CoinGecko series are pinned to Ethereum and the confirmed Polygon DEZ contract.
A manual override must carry a non-empty owner-defined series. Previous rates
and valuations remain immutable audit history.

## USD valuation and coverage

The exact signed token amount is multiplied by the current exact daily rate for
the transaction's UTC date. The database retains the unrounded numeric result.
Presentation rounding remains a separate UI concern.

No rate fallback, current-price substitution or interpolation occurs. The
coverage view reports total, valued and missing-rate transaction counts and
marks a report complete only when every active transaction is valued.

## Rollback and security

Race-dataset rollback deselects only the rolled-back batch's economic
contributions. A transaction remains active when another accepted contribution
still supports it; otherwise it becomes excluded while its audit history
remains present.

All new tables use forced owner row-level security, all functions and views
revoke `PUBLIC` access, and the migration has a complete reverse path before
migration `0008` is removed.

Synthetic PostgreSQL 16 verification covers exact atomic conversion, zero
suppression, idempotent replay, source provenance, missing-rate coverage,
rate supersession, exact USD multiplication, provider-series validation,
owner isolation and dataset rollback.
