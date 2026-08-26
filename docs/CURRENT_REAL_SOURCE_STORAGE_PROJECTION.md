# Current Real-Source Neon Storage Projection

## Purpose

This document records the current reproducible Neon capacity decision for the owner’s audited **nine-file** DNA Racing source shape after the archive-backed retention work through migration `0067` removes durable historical `race_entry` detail.

It is a **pre-upload safety gate**. It does not authorise a real upload, paid provider capacity, Production changes, Vercel deployment or public release.

The protected Neon Preview branch has a logical-size limit of **512 MiB** (**536,870,912 bytes**).

## Audited source shape

The current source profile contains:

- seven sequential Race Merge segments;
- one Core Details export;
- one Current Arena export;
- **2,691,579** Race Merge rows / race-entry observations;
- **746,648** unique Race events;
- **18,513** Core Details rows; and
- **1,474** Current Arena rows.

The seven current Race segment row counts are:

1. **252,202** rows;
2. **283,637** rows;
3. **504,532** rows;
4. **491,315** rows;
5. **503,788** rows;
6. **501,236** rows; and
7. **154,869** rows at the audited point in time.

The file count is not a lifetime contract. Older completed Race segments become immutable history and future rollover segments extend the sequence. Normal recurring updates remain the current Race segment plus the latest Core Details and Current Arena exports.

## Retention changes through migration 0067

The storage-critical archive sequence now establishes that:

- immutable Race source evidence is retained in private checksummed R2 objects;
- archive manifests, source-version receipts, Core locators and publication receipts remain in Neon;
- Race-derived Core Performance, Discovery, payout-format and star read models are rebuilt exactly from immutable archive evidence;
- rolling Race reuploads are spillably deduplicated by lifetime Race identity;
- Core Details and Current Arena refreshes preserve the last valid Race-derived aggregate publication;
- accepted staging/contribution evidence and detailed source provenance have guarded compaction paths;
- migration `0067` deletes normalized historical `race_entry` rows only after exact archive publication, evidence/locator coverage, retained event identity, read-model parity and rollback/rebuild prerequisites are satisfied; and
- `race_event` and `event_star_validation` remain durable because event/star/manual-reconciliation identity is still intentionally retained in Neon.

This closes the earlier **durable historical `race_entry`** capacity blocker. It does not by itself prove that a large Race spreadsheet can be imported without exceeding the branch limit before compaction runs.

## PostgreSQL 18 measurement

`database/measurements/current_real_source_neon_lower_bound.sql` applies the complete migration chain on PostgreSQL 18 and measures representative rows with `pg_column_size` against the actual current composite types.

### Durable retained rows

Measured minimal payloads are:

- `race_event`: **129 bytes**;
- `event_star_validation`: **158 bytes**; and
- Core/Arena `dataset_version_record`: **160 bytes**.

For the current source shape, the retained lower bound is:

- `race_event`: **96,317,592 bytes** (~91.86 MiB);
- `event_star_validation`: **117,970,384 bytes** (~112.51 MiB);
- Core/Arena `dataset_version_record`: **3,197,920 bytes** (~3.05 MiB); and
- total durable post-publication lower bound: **217,485,896 bytes** (~207.41 MiB).

Explicit lower-bound durable headroom is therefore:

**536,870,912 − 217,485,896 = +319,385,016 bytes (~304.59 MiB).**

The prior durable lower bound of **675,054,326 bytes (~643.78 MiB)** is superseded by the implemented `race_entry` archive compaction boundary.

### Per-row transient Race materialisation

The current Race acceptance path still temporarily creates several full-row PostgreSQL relations before its existing compaction/finalisation steps can remove them.

Measured minimal per-source-row payloads are:

- `dataset_staged_record`: **160 bytes**;
- `normalized_race_staged_fact`: **154 bytes**;
- `dataset_record_contribution`: **144 bytes**;
- transient Race `dataset_version_record`: **160 bytes**;
- `race_entry`: **178 bytes**; and
- `race_entry_source`: **194 bytes**.

Combined minimum transient Race payload:

**990 bytes per Race source row.**

This still excludes heap/page overhead, line pointers and indexes, so it is a strict lower bound.

## Sequential initial-import peak

The proof evaluates each of the seven historical Race segments sequentially using the actual segment row count and cumulative unique-event count at that point in history.

The worst current initial-import lower bound occurs at **segment 6**, where **501,236** source rows coexist with **695,901** retained cumulative Race events before the transient row ledgers can be compacted.

Minimum initial sequential peak:

**695,947,227 bytes (~663.71 MiB).**

Headroom against the protected 512 MiB branch:

**−159,076,315 bytes (~−151.71 MiB).**

This is already conclusively unsafe before indexes, heap/page overhead, aggregate read models, economics, control rows, receipts or optional populated text are added.

## Full rolling-segment peak

For future recurring updates the proof also evaluates the conservative case where the full retained current history is present and a Race segment as large as the largest observed segment (**504,532 rows**) is uploaded before transient compaction completes.

Minimum rolling-segment peak:

**716,972,576 bytes (~683.76 MiB).**

Headroom:

**−180,101,664 bytes (~−171.76 MiB).**

Therefore merely uploading the spreadsheets sequentially does **not** solve the branch limit while the current per-row Neon staging/materialisation architecture remains intact.

## Conservatism and omitted storage

Both durable and peak figures are lower bounds. They omit storage that would only increase actual usage, including:

- PostgreSQL heap/page overhead and line pointers;
- indexes on measured relations;
- optional populated Race text and economic fields;
- aggregate/read-model rows such as Core Performance, Discovery, payout-format and Core star profiles;
- economic transaction, contribution, valuation and exchange-rate state;
- bounded import/control/evidence-manifest/version/compaction receipts;
- Core Details and Arena materialized state beyond the minimal version ledger; and
- the existing schema/logical footprint.

Because the **minimum sequential peak already exceeds the branch limit**, these omissions cannot reverse the current decision.

## Decision

**First real owner upload remains STOP / UNSAFE.**

The storage diagnosis is now materially narrower:

- **durable post-publication retention is no longer the demonstrated blocker**; migration `0067` reduces the measured durable lower bound to ~207.41 MiB;
- **temporary Race staging/materialisation is the demonstrated blocker**; the current path creates at least **990 bytes of transient Neon row payload per Race source row**, producing a minimum current sequential peak of ~663.71 MiB and a conservative full rolling-segment peak of ~683.76 MiB.

No provider-capacity upgrade should be inferred from this result. The next dependency should reduce or bypass the per-row Race staging/materialisation footprint rather than redesigning immutable archive storage again.

## Next dependency-critical architecture slice

Implement an **archive-first bounded Race acceptance path** that avoids holding a whole large Race segment simultaneously in the current Neon staging/materialisation relations.

The preferred direction is:

1. retain the uploaded full Race spreadsheet / staged immutable evidence in private checksummed R2;
2. process Race rows in bounded partitions or streams;
3. validate natural keys, fingerprints, chronology, event consistency, overlap and conflicts without accumulating a full segment in `dataset_staged_record`, `normalized_race_staged_fact`, `dataset_record_contribution`, Race `dataset_version_record`, `race_entry` and `race_entry_source` at the same time;
4. preserve exact accepted/quarantined row counts and issue semantics;
5. preserve event/star/economic identity required before archive publication;
6. keep rollback/rebuild and replay fail-closed;
7. compact each bounded partition or replace the full-row Neon ledger with compact support state before advancing to the next partition; and
8. rerun PostgreSQL 18 durable **and physical/minimum-peak** evidence until there is explicit positive safety headroom below 512 MiB.

The existing private R2 + spillable aggregate architecture remains the preferred storage architecture. Reading source spreadsheets directly from the owner’s computer is not required.

## Reproducibility

The `Current real-source storage projection` GitHub Actions workflow uses PostgreSQL 18, applies the complete current migration chain and executes `database/measurements/current_real_source_neon_lower_bound.sql`.

PR #302 first exact measurement head `0a8e48013756cbd63043a16f1a98a5681bbfd9b9` / workflow run **32931012381** measured:

- durable post-publication lower bound: **217,485,896 bytes**;
- durable headroom: **+319,385,016 bytes**;
- transient Race payload: **990 bytes per source row**;
- initial sequential peak lower bound: **695,947,227 bytes**;
- initial sequential peak headroom: **−159,076,315 bytes**;
- full rolling-segment peak lower bound: **716,972,576 bytes**;
- full rolling-segment peak headroom: **−180,101,664 bytes**; and
- result: `UNSAFE_CURRENT_SEQUENTIAL_RACE_PEAK`.

Future retention or Race-ingestion changes must update this proof explicitly rather than inherit an obsolete capacity decision.
