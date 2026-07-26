# Phase 9 hosted migration attestations

Status: synthetic, non-executable evidence contract.

## Purpose

Convert reversible PostgreSQL checks into the migration projection consumed by
the cumulative Phase 9 rehearsal. A single migration `passed` flag is
insufficient.

The exact ordered sequence is:

1. apply the reviewed migration set;
2. run synthetic schema and persistence smoke checks;
3. reverse the migration;
4. verify temporary-object removal and baseline schema restoration.

Every step binds a fixed command identifier to the exact candidate head,
migration-set digest, opaque target fingerprint, UTC interval and exit code.
All steps must use the same ephemeral non-Production target. Evidence summaries
remain redacted and private data must not be loaded.

Missing runtime or steps remain review-required. Stale heads, command
substitution, digest drift, failed or overlapping steps, Production targets,
persistent targets, unredacted evidence, private data or incomplete schema
restoration block the projection.

The contract does not connect to PostgreSQL, retain private artifacts or grant
Production authority.
