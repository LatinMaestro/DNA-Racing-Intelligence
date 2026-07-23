# Phase 1 Race Economics and USD Valuation Contract

Date: 23 July 2026  
Status: owner-confirmed implementation contract  
Production: disabled and fail-closed

## Source semantics

| Source      | Contract                                                 |
| ----------- | -------------------------------------------------------- |
| `rpayout`   | Payout mechanism/format label; never an amount           |
| `rfee`      | Exact non-negative fee for the row's core entry          |
| `prize`     | Exact non-negative gross payout for the row's core entry |
| `toke_curr` | Common entry/payout asset: ETH or DEZ                    |
| `r_tags`    | Raw eligibility and restriction tags                     |

`rformat` remains separate event-format provenance. Numeric zero is a real zero. Missing, blank, malformed, negative or unsupported-asset data is review-required.

## Ledger derivation

For an accepted owned-core entry:

- derive at most one fee debit from a positive `rfee`;
- derive at most one payout credit from a positive `prize`;
- use the accepted race-entry natural key plus transaction type;
- preserve exact decimal text and asset;
- do not create money from `rpayout` or `r_tags`;
- do not create zero-value ledger rows merely to represent a non-payment;
- classify the race stage separately and allow unknown;
- represent refunds, reversals and corrections through explicit auditable records.

## Assets

- ETH: CoinGecko coin ID `ethereum`.
- DEZ: Polygon token `0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E`.
- BGC: not a racing asset; separate breeding/burning credit with owner-confirmed USD 1 = BGC 1 reference.

## Daily USD valuation

Use the event timestamp's UTC calendar date. Every asset/date rate record contains an exact USD-per-asset decimal, provider identity, series identity, source timestamp, retrieval timestamp, method and supersession history.

The initial free source is CoinGecko historical data. Rates are background-fetched and cached. Routine pages do not call CoinGecko. Free historical coverage limitations are explicit: unavailable dates remain missing until an owner-supplied rate file or another approved free source is accepted.

Converted USD equals exact source amount multiplied by the exact stored daily rate. Store the unrounded exact result; round only presentation while retaining enough visible precision for sub-cent race activity. Aggregate USD reports are partial if any included amount lacks a valid rate.

## R2/Neon placement

Detailed immutable Race Merge facts and analytical partitions live in private R2 Parquet. Neon retains transactional state: dataset/object manifests, selected versions, identity/reconciliation queues, exact race economics, cached daily rates and compact aggregates.

Activation is two-phase and fail-closed:

1. write versioned objects and verify checksums/counts;
2. atomically select the Neon manifest only when all expected objects and compact writes succeed.

Rollback selects the previous complete manifest. No automatic provider upgrade, Production activation or custom domain is permitted.

## Repository contract implementation

The TypeScript domain layer provides:

- plain exact-decimal normalization, negation and multiplication using `BigInt` rather than binary floating point;
- strict ETH/DEZ race-economic validation;
- stable entry-fee and payout keys;
- omission of zero-value ledger rows;
- separate payout-mechanism and race-tag provenance;
- UTC event-date keys;
- contract-pinned CoinGecko series identifiers;
- exact signed USD valuation; and
- an explicit null result when a historical rate is unavailable.

Malformed economics remain review-required without discarding an otherwise valid historical race result.
