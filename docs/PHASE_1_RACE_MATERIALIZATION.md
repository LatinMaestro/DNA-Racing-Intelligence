# Phase 1 Normalized Race Merge Materialization

Date: 23 July 2026  
Status: repository migration and ephemeral PostgreSQL verification  
Production: disabled and fail-closed

## Scope

Migration `0003_race_materialization` connects schema-ready Race Merge adapter
facts to the existing dataset acceptance ledger and normalized `race_event`,
`race_entry` and `race_entry_source` tables. It remains repository-only and uses
synthetic fixtures. It does not connect to Neon, upload private files, derive an
economic transaction or refresh an analytical profile.

## Transaction boundary

The worker must perform the following in one PostgreSQL transaction:

1. create the validating import manifest;
2. write every row's acceptance identity to `dataset_staged_record`;
3. write one `normalized_race_staged_fact` for every ready Race Merge row;
4. call `dna.accept_staged_race_dataset`; and
5. commit only after the wrapper returns successfully.

The wrapper locks the owner-scoped manifest, verifies that every ready row has
one typed fact, quarantines whole events whose structural metadata disagree,
calls the existing owner/source-locked acceptance executor, and materializes
only rows still marked ready. An unhandled validation or persistence failure
rolls back the manifest, version activation, facts and aggregate job together.

Calling the wrapper again for an already accepted batch is idempotent. Stable
owner/event and owner/event/core UUIDs plus unique database keys prevent event,
entry and provenance duplication.

## Normalized and source fields

The private staging table validates:

- source event and core IDs;
- canonical event time;
- bike, car or horse mode;
- exact positive distance and gate count;
- optional gate position;
- nullable Gold and Blue values;
- complete, partial, missing or invalid star status;
- positive finish position; and
- the exact positive elapsed-time source decimal.

`gold_star_eligible` remains database-derived from `gate_count > 3`. A source
Gold assignment at one to three gates is preserved, with its staged warning,
rather than rewritten.

Source Gold, Blue, elapsed time, fee, payout, prize, asset, format, obsolete
class and source timestamp values remain attached to `race_entry_source` for
private audit. Routine logs continue to expose counts and stable issue codes
only.

## Deliberately deferred semantics

The supplied elapsed-time unit has not yet been confirmed. The exact source
decimal is therefore retained while `elapsed_time_milliseconds` and
`speed_microunits` remain null. No unit conversion is guessed.

Race fee, payout, prize and asset semantics also remain unvalidated.
Materialized entries retain `economic_data_status = unvalidated`, and this
migration cannot create an `economic_transaction`. Gate B still requires
representative-data validation before race-derived accounting.

## Conflicts and rollback

All ready rows for a source event are quarantined when event time, mode, exact
distance or gate count disagree within the batch or with a previously
materialized event. The accepted fact is never overwritten silently.

Materialized events and entries retain immutable batch provenance and an
`active_in_dataset` state. The owner-scoped rollback wrapper first restores the
prior dataset ledger version, then deselects provenance from the rolled-back
batch and deactivates only facts that have no remaining non-rolled-back source.
Historical rows and provenance remain auditable.

## Privacy and security

`normalized_race_staged_fact` is private normalized user data. It has forced
owner row-level security, no `PUBLIC` access and cascade deletion only through
its owner-scoped staged manifest record. Materialization and rollback functions
also revoke `PUBLIC` execution. No source rows, IDs, names or economic values
are committed by this migration or its synthetic smoke test.

## Ephemeral verification

PostgreSQL 16 CI verifies:

- typed normalized staging and manifest completeness;
- whole-event conflict quarantine within and across batches;
- deterministic event, entry and known-core materialization;
- raw source provenance retention without elapsed-time or economic inference;
- preservation of ineligible source Gold with derived eligibility;
- exact replay without duplicate versions, entries or provenance;
- cumulative activation and rollback to the prior active fact set;
- failure rollback when a ready row lacks a normalized fact;
- forced owner RLS and revoked function privileges; and
- complete reversal before earlier migrations are removed.
