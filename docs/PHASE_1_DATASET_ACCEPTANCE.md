# Phase 1 Dataset Acceptance Contract

Date: 23 July 2026  
Status: implemented with synthetic verification  
Production: disabled and fail-closed

## Purpose and boundary

`domain/dataset-acceptance.ts` defines the provider-independent transaction
contract that a later PostgreSQL executor must apply atomically. It accepts
already validated, canonical records identified by a stable natural key and a
lowercase SHA-256 fingerprint. It never receives raw CSV rows and it does not
make analytical, race-economic or identity-linking claims.

This contract does not activate hosted infrastructure or import private data.
The PostgreSQL executor remains a separate focused slice so its locking,
owner-scope and rollback behavior can be migration-tested directly.

## Acceptance rules

- A previously accepted file checksum is an idempotent no-op. It cannot create
  another dataset version.
- A natural key with the same fingerprint is an exact repeat. The accepted row
  is stored once, while the contributing batch identifier is retained as
  provenance.
- A natural key with a different fingerprint is quarantined. The previously
  accepted value is never overwritten silently.
- Conflicting instances of one natural key inside a batch are all quarantined.
- A non-empty batch with no acceptable rows cannot activate a version.
- Rows omitted by a later Race Merge or Core Details cumulative file remain in
  the next version; omission is not evidence of deletion.
- Current Vault and Current Arena are historical snapshots. Their active record
  set is replaced by each accepted snapshot, while every prior version remains
  immutable and rollback-capable. A changed snapshot fact is historical state,
  not a cumulative-source conflict.
- `dataCurrentThrough` cannot move backwards. A stale candidate is quarantined
  and the active version remains unchanged.
- A missing current-through value carries forward the last known accepted value
  rather than erasing freshness evidence.
- Import completion, data current-through and aggregate refresh are separate
  timestamps. A null aggregate refresh remains visibly incomplete.

## Version activation and rollback

Planning is immutable: validation or quarantine returns an unchanged clone of
the input state. Successful acceptance creates exactly one new active version,
makes the prior active version inactive and preserves the complete active record
snapshot for that source. A rollback may target only the active version; it
marks that version rolled back and restores the latest prior non-rolled-back
snapshot.

Accepted checksum history is retained after rollback. Replaying identical bytes
therefore remains idempotent and cannot silently reactivate a rejected version.
A corrected import must have corrected content and a different checksum.

## Privacy and observability

The private transaction plan may contain stable natural keys so the persistence
layer can reconcile exact rows. Routine logs must use
`redactAcceptanceSummary`, which exposes only status, counts and issue codes. It
does not expose natural keys, fingerprints, source rows, asset names or owner
data.

## Required PostgreSQL executor behavior

The next slice must:

1. lock the owner/source dataset stream before calculating the next version;
2. enforce owner scope and one active version at the database boundary;
3. persist import counts, conflict warnings and provenance in one transaction;
4. activate the dataset version only after all acceptable rows are durable;
5. roll the entire transaction back on an unhandled failure;
6. verify concurrent acceptance, exact replay and rollback using PostgreSQL 16;
7. keep raw files private and leave Production disabled.

## Synthetic evidence

The contract tests cover first activation, exact-checksum replay, cumulative
omissions, exact-row provenance, cross-batch and intra-batch conflicts, stale
coverage, missing freshness, snapshot sources, reversible rollback, input
immutability and count-only summaries. All fixtures are synthetic.
