# Phase 9 hosted check attestations

Status: synthetic, non-executable evidence contract.

## Purpose

Convert hosted cumulative-rehearsal facts into the exact check projection used
by Phase 9. A plain `passed` flag is insufficient.

Each required check records:

- one reviewed fixed command identifier;
- the exact composed head;
- exact UTC start and completion times;
- a non-negative exit code;
- a SHA-256 digest of the redacted summary;
- hosted-workspace execution; and
- explicit privacy and synthetic-fixture facts.

Missing evidence remains review-required. Stale heads, command substitution,
failed checks, local execution, inverted timestamps, unredacted summaries or
private data block the projection.

The end-to-end and import/replay/rollback/reconciliation suites must use
synthetic fixtures only. Git and routine evidence retain only redacted summaries
and digests.

The contract never retains private artifacts, dispatches Actions or mutates
Production.
