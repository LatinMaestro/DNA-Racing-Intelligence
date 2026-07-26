# Phase 9 hosted recovery attestations

Status: synthetic, non-executable evidence contract.

## Purpose

Bind import, replay and recovery evidence to one exact candidate head, source
contract and synthetic fixture manifest.

Required scenarios cover:

- grouped sequential Race Merge append ordering;
- boundary deduplication and replay;
- older historical backfill;
- replacement Vault and Arena snapshots;
- Core Details upsert and lineage refresh;
- malformed/conflict quarantine;
- recoverable rollback;
- aggregate retry and reconciliation;
- accepted-version freshness and provenance; and
- bounded-memory processing.

Every scenario records a fixed command identifier, exact UTC execution bounds,
redacted-summary digest and complete assertion counts. Replay and aggregate
retry must be idempotent. Failed or quarantined attempts must not activate a
version. Rollback must restore the previous accepted state. Freshness must bind
only to accepted source versions.

Missing scenarios remain review-required. Stale heads, command substitution,
manifest drift, failed assertions, incomplete recovery guarantees, private data
or non-synthetic fixtures block the projection.

The contract retains no private artifacts and cannot dispatch Actions, merge,
connect providers or mutate Production.
