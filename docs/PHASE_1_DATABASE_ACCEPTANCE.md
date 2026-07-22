# Phase 1 PostgreSQL Dataset Acceptance

Date: 23 July 2026  
Status: implemented for repository and ephemeral PostgreSQL verification  
Production: disabled and fail-closed

## Scope

Migration `0002_dataset_acceptance` implements the database transaction boundary
for the provider-independent acceptance contract. It does not connect to Neon,
upload private files, persist source rows in Git or activate Production.

The importer stages only stable natural keys, SHA-256 fingerprints, row numbers,
readiness and issue codes. Raw CSV values remain outside this acceptance layer.

## Atomic acceptance

`dna.accept_staged_dataset`:

- derives the owner from transaction-local `app.owner_id` and fails closed when
  it is absent;
- locks one owner/source stream before calculating the next version;
- accepts only a batch in `validating` state;
- checks staged rows against the manifest count;
- quarantines intra-batch fingerprint disagreement;
- quarantines cross-batch fingerprint conflicts for cumulative Race Merge and
  Core Details sources without overwriting the accepted fact;
- treats Current Vault and Current Arena as replacement historical snapshots;
- rejects a current-through regression without changing the active version;
- stores only newly accepted Race Merge/Core Details identities as immutable
  version deltas, avoiding a full multi-million-row copy per import;
- resolves the cumulative active set through non-rolled-back deltas, so omitted
  accepted history remains active without storage multiplication;
- exposes that resolved set through the owner-RLS-aware
  `dna.active_dataset_record` view, while snapshot sources expose only their
  active version;
- records one contribution per accepted natural key and batch;
- records accepted, rejected and warning counts on the manifest;
- activates exactly one version only after all database writes succeed; and
- queues aggregate refresh separately without claiming it has completed.

Calling acceptance again for an already accepted batch returns its existing
version and cannot activate another version. The existing owner/source/checksum
constraint prevents the same file bytes from being registered as a second
batch.

## Rollback

`dna.rollback_active_dataset` locks the same owner/source stream, marks only the
active version and its batch rolled back, preserves staged and contribution
provenance, rolls back any queued/running aggregate job and restores the latest
prior non-rolled-back version. A reason is mandatory.

This version ledger does not delete private source files or initiate a domain
transaction. Later source-specific persistence must participate in the same
worker transaction before activation.

## Privacy and access

All four added tables are owner-scoped, have forced row-level security and
revoke access from `PUBLIC`. Both executor functions also revoke `PUBLIC`
execution. Application-role grants remain a Preview account-action boundary.

Natural keys and fingerprints are private database evidence and must not enter
routine logs. The application continues to expose only count/code summaries.

## Ephemeral verification

PostgreSQL 16 CI applies migrations 0001 and 0002, runs synthetic smoke tests,
reverses 0002, verifies its objects are gone, reverses 0001 and verifies the
schema is gone. The 0002 smoke test covers cumulative retention, exact replay,
conflict quarantine, stale rejection, snapshot replacement, queued aggregate
refresh, atomic failure rollback, owner RLS, function privilege revocation and
restoration of prior cumulative and snapshot versions.
