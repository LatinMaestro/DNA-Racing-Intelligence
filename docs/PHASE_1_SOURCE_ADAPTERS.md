# Phase 1 Synthetic Source Adapters

Date: 23 July 2026  
Status: verified adapter contract; transactional acceptance remains pending  
Deployment scope: repository and synthetic tests only

## Purpose

The source adapters convert schema-ready CSV rows into conservative typed records for Race Merge, Core Details, Current Vault and Current Arena. They preserve source-column/value provenance in private staging and quarantine rows when required identity, timestamp, mode, distance or structural values are invalid.

Schema readiness and row readiness remain separate from dataset acceptance. These adapters do not write to PostgreSQL, activate a dataset version, derive an economic transaction or refresh an analytical aggregate.

## Supplied-export observations

Aggregate-only profiling confirmed:

- Race Merge `rcb` contains exact race distance and is mapped to canonical `distance`;
- `rstart_time` is the precise race event time, while `event_datetime` is retained as a separate source timestamp;
- Race Merge modes are bike, car and horse;
- historical star values use case-varying Boolean text;
- Core Details and Current Vault F-numbers use an `F` prefix;
- class, element and sex casing varies across exports; and
- the Current Vault export requires Windows-1252 handling.

No source names, IDs, rows, filenames or private derived values are committed.

## Adapter rules

### Race Merge

- retain source event and core IDs;
- normalize event timestamps without discarding the separate source timestamp;
- normalize bike, car and horse without combining modes;
- require a positive exact distance, gate count and finish position;
- preserve elapsed time as an exact source decimal until the unit-normalization boundary is verified;
- normalize Gold and Blue as nullable Booleans and distinguish complete, partial, missing and invalid star data;
- derive `gold_star_eligible = gate_count > 3`;
- retain a source Gold assignment at three gates or fewer with `GOLD_INELIGIBLE_ASSIGNMENT` rather than rejecting or rewriting it;
- preserve obsolete race class for provenance only; and
- keep fee, payout, prize and asset fields as source values with `economicDataStatus = unvalidated`.

### Core Details

- treat the Bike-labelled file as cross-mode Core Details;
- map legacy `bikeid` to `core_id`;
- normalize class, element, F-number and sex;
- preserve parent IDs and source names for later lineage resolution.

### Current Vault

- treat it as a historical ownership/ME snapshot;
- normalize core attributes and nullable ME state;
- keep name-only identities in `review_required` rather than selecting an ambiguous normalized-name match automatically.

### Current Arena

- retain the source core ID and exact USD source price string;
- treat the row only as a historical listing snapshot; and
- set `createsEconomicTransaction = false` so a listing cannot create breeding income.

## Privacy and logging

In-memory provenance retains raw headers and values for private audit. The routine summary contains only row status, source type, source-column count and stable issue codes. It cannot include filenames, raw headers, raw values, core names or IDs.

## Deferred acceptance boundary

The next focused slice will provide cumulative deduplication, conflict handling, transactional dataset-version activation, current-through/import/aggregate timestamps and rollback. Race economic derivation remains blocked until fee and payout semantics are validated as required by Gate B.

## Owner-confirmed race economics amendment

Race Merge economics are no longer globally unvalidated. The adapter now:

- maps `rpayout` to a payout-mechanism label rather than an amount;
- maps `r_tags` to preserved race-restriction text;
- validates `rfee` and `prize` as exact non-negative per-entry decimals;
- normalizes `toke_curr` case-insensitively to ETH or DEZ;
- distinguishes ready, missing, invalid and unsupported-asset economic states;
- keeps a structurally valid race row available when only its economics require review; and
- creates no ledger transaction at the adapter boundary.

Exact signed transactions and daily USD valuation are derived only after accepted owned-core identity and source validation.
