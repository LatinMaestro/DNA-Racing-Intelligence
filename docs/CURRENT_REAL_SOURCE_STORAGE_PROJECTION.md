# Current Real-Source Neon Storage Projection

## Purpose

This document records the first reproducible normalized-storage capacity decision for
the owner’s currently audited DNA Racing import set. It is a **pre-upload safety
gate**. It does not authorise a real upload, paid provider change, Production change
or public deployment.

The source counts come from `docs/AGGREGATE_SOURCE_PROFILE.md`, which records the
11 August 2026 streaming audit of the current recurring source set:

- Race Merge: 2,691,579 rows;
- Core Details: 18,513 rows;
- Current Arena: 1,474 rows; and
- total recurring source rows: **2,711,566**.

The current protected Neon Preview branch has a logical-size limit of **512 MiB**
(536,870,912 bytes).

## Why raw-file size is not enough

The existing provider upload gate deliberately used a conservative `2 × raw bytes`
Neon staging placeholder. That is useful for failing closed, but it does not answer
whether the normalized persistent model can fit after import.

The current schema retains owner-scoped acceptance provenance in PostgreSQL. It
stores one `dna.dataset_staged_record` for every source row, including a
quarantined row, and one `dna.dataset_record_contribution` for each accepted
natural key in each contributing import batch.

The current source audit found zero within-file duplicate Race entry keys and unique
Core Details and Current Arena IDs. The projection therefore models the intended
usable import, in which the audited valid rows retain accepted contribution
provenance. An unexpectedly quarantined row would still consume its staging row but
would not consume a contribution row.

This is before counting normalized Race staging facts, dataset-version records, race
events, race entries, race-entry source provenance, Core/Arena materialization, page
line pointers, indexes, aggregate tables or future imports.

## PostgreSQL 18 measurement

`database/measurements/current_real_source_neon_lower_bound.sql` applies the actual
schema and uses `pg_column_size` against the two real composite table types with the
smallest legal representative values.

Measured minimum composite payloads:

- `dna.dataset_staged_record`: 160 bytes per source row;
- `dna.dataset_record_contribution`: 144 bytes per source row; and
- combined minimum: **304 bytes per source row**.

At 2,711,566 recurring source rows this gives:

- staged-record minimum: 433,850,560 bytes, about 413.75 MiB;
- contribution minimum: 390,465,504 bytes, about 372.38 MiB;
- **two-ledger minimum: 824,316,064 bytes, about 786.13 MiB**; and
- Preview total logical-size limit: 536,870,912 bytes, exactly 512 MiB.

The two-ledger minimum is therefore approximately **1.535 × the entire Preview
branch limit** before any PostgreSQL heap/index overhead or any other application
table is counted.

The mandatory staging rows alone leave only 103,020,352 bytes of the branch limit.
At the measured 144-byte contribution payload, that remainder can hold at most
715,419 accepted contribution rows. At least **1,996,147 rows, or 73.62% of the
current source set, would therefore have to lose accepted contribution provenance**
before even these two ledgers could fit.

That is not a usable import outcome, and it still ignores page/index overhead and all
normalized/materialized relations. Capacity planning cannot rely on quarantining or
discarding valid source evidence merely to make storage fit.

## Decision

**Current real Preview import: STOP / UNSAFE under the present Neon-retained
provenance model.**

Do not request or perform the first real upload while this condition remains.
Increasing a provider limit or moving to paid capacity is not authorised by this
evidence and must not be inferred as the solution.

The next dependency-critical architecture slice is to reduce high-volume PostgreSQL
retention while preserving auditability, idempotency, rollback and source provenance.
The existing architecture already designates private R2 for raw and partitioned
analytical data, so large row-level staging/provenance should be evaluated for private
object-storage persistence with compact Neon manifests/receipts rather than deleting
evidence or weakening acceptance rules.

Any replacement design must then rerun this measurement against the changed schema and
prove that:

- the first 9-file real source shape fits with explicit headroom;
- a later growing Race Merge update remains bounded;
- exact replay and cross-segment overlap remain idempotent;
- rollback/recovery does not require retaining duplicated multi-million-row Neon
  staging ledgers;
- raw/private analytical objects remain non-public and owner-scoped; and
- no Production or paid-service authority is implied.

## Compact evidence-object control plane

Migration 0045 introduces the first executable part of the replacement design:
an owner-scoped Neon manifest for immutable private evidence objects. Each manifest
row binds one import batch and source family to a bounded partition number, object
format, private object key, SHA-256 checksum, byte count, row count and optional
natural-key range.

Registration is least-privilege and replay-safe: the same batch, object kind and
partition returns the same deterministic receipt only when all immutable metadata
matches. A changed checksum, size, row count, format, key or range fails closed.
Forced row-level security keeps the compact control plane owner-isolated.

This migration does **not** remove either high-volume Neon ledger and therefore does
not clear the real-upload stop condition. The next slices must make the Worker write
and verify these private objects, switch acceptance/replay/rollback to the manifest
boundary, remove duplicated row-level Neon retention, and rerun the complete capacity
projection including normalized and read-model storage.

## Reproducibility

The dedicated `Current real-source storage projection` GitHub Actions workflow uses
PostgreSQL 18, applies the complete migration chain and executes the measurement SQL.
The SQL fails if the measured row sizes or the audited projection change unexpectedly,
so this decision cannot silently become stale after a schema change to the measured
relations or a source-profile update.
