# Aggregate Source Profile

## Purpose and evidence boundary

This document records aggregate observations from the owner's real DNA Racing source
exports. It establishes import and product behaviour without placing large raw files,
individual source rows or owner-specific records in Git.

The source data and ownership information are publicly observable game data. Repository
exclusion is therefore a storage, reproducibility and data-governance decision rather
than a confidentiality claim. Infrastructure credentials remain secret.

## Inspected source set — 11 August 2026

The full streaming scan covered ten CSV files and 392,495,130 source bytes:

- seven sequential Race Merge segments;
- one Core Details export (legacy filename: Bike Details);
- one Current Arena export; and
- one Current Vault spreadsheet used only as a temporary ownership reference.

The recurring import set is the first nine files: 392,487,223 bytes. Current Vault is
not a production import source; My Vault remains a durable Core-ID registry.

No raw export was committed to Git.

## Race Merge aggregate profile

All seven Race Merge segments have the same 20-column header:

`event_id,event_datetime,rstart_time,rmode,rclass,rcb,token_id,name,gate,rgate_count,gold_star,blue_star,pos,time,rformat,rpayout,rfee,prize,toke_curr,r_tags`

Observed across the seven segments:

- 2,691,579 entry rows;
- 746,648 unique events;
- 17,526 unique raced Core IDs;
- race-start coverage from `2024-07-06T19:41:00.482Z` through
  `2026-08-11T04:58:34.176Z`;
- 1,581,160 bike entries, 489,407 car entries and 621,012 horse entries;
- distances from 900 m through 2,300 m, in 100 m steps;
- positive elapsed times from 44.710 seconds to 147.728 seconds;
- currencies `DEZ` (2,542,325 rows), `ETH` (148,256) and the known historical
  `BGC` exception (998);
- 25 fee values expressed in scientific notation and no scientific-notation prizes;
- zero malformed-width rows, zero within-file duplicate `event_id + token_id` rows
  and 13 cross-segment overlapping event IDs covering 67 entry rows.

The importer must deduplicate segment overlap on durable race-entry identity. It must
accept all sequential Race Merge segments rather than assuming a permanent file count.

`rgate_count` describes the configured race field, not a guaranteed exported row
count: 139,537 events had fewer exported rows than the declared field and seven had
more. Row-count equality is therefore not a valid completeness invariant; the seven
overfilled cases remain anomaly/review candidates.

Gold and Blue star columns contained only case variants of `true` and `false`, with
no missing values. No event had multiple Gold or Blue stars, and no Gold star appeared
in a field of three gates or fewer.

Race names are display metadata, not identity: 138,260 race rows had no name and 4,542
race rows disagreed with the current Core Details name for the same ID.

## Core Details aggregate profile

The Core Details schema is:

`bikeid,core_name,core_type,gender,f_no,element,color,father_name,father_id,mother_name,mother_id`

Observed:

- 18,513 rows and 18,513 unique Core IDs;
- 14,567 rows with both parents and 3,946 with neither parent;
- no one-parent rows, self-parent rows or unresolved parent IDs;
- parent names agreed with the referenced parent IDs;
- 17 normalized names were reused by more than one Core ID; and
- 2,147 historical raced Core IDs were absent from the current Core Details snapshot.

Durable Core ID is authoritative for history, lineage and ownership. Name matching is
never sufficient as the persistent key.

## Current Arena aggregate profile

The Current Arena schema is `token_id,price_usd`.

Observed:

- 1,474 rows and 1,474 unique Core IDs;
- no duplicate IDs;
- all prices were valid, from USD 1 through USD 120; and
- one Arena ID was absent from the current Core Details snapshot.

## Current Vault reference profile

The reference spreadsheet schema is
`core_name,f_no,core_type,element,gender,me`.

Observed:

- 195 rows;
- 68 `ME = TRUE` and 127 `ME = FALSE`;
- 193 unique deterministic matches to current Core Details; and
- two ambiguous name matches caused by reused Core names, with no unmatched rows or
  attribute mismatches.

That ambiguity confirms why the spreadsheet is reference-only and why My Vault must be
maintained by durable Core ID.

## Import and hosting consequences

The real schemas match the current source-family registry and adapter aliases. Existing
encoding, boolean and decimal handling covers the observed values.

The current recurring payload is about 392.5 MB before normalization. A hosted Preview
import therefore requires a measured provider-capacity projection, configured upload
completion and activation actions, and a proven rollback/recovery path. Until those
gates pass with synthetic Preview data, the real exports remain out of hosted Preview
and Production.
