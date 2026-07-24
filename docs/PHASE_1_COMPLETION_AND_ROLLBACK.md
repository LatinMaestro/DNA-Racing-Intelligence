# Phase 1 Completion and Rollback

## Purpose

This slice completes the provider-neutral owner workflow after background
processing. It defines:

- a deterministic private completion report; and
- an owner-confirmed rollback service for one active source version.

It does not provision persistence, mutate a hosted database, expose an upload
route or enable Preview or Production.

## Completion reporting

The report is bound to one durable update session and lists every processed
source file with:

- source family and internal batch ID;
- accepted, duplicate, quarantined and warning counts;
- identity and reconciliation review counts;
- data-current-through where available;
- exact replay status; and
- whether a prior version is available for rollback.

Recommendation readiness remains partial while aggregate refresh is pending,
failed or superseded, or while quarantine/identity/reconciliation review remains.
A wholly quarantined update is blocked. An exact replay creates no accepted
change, needs no refresh and does not manufacture a rollback boundary.

Accepted changes cannot claim aggregate refresh was not required. Aggregate
completion cannot be claimed when the session changed no accepted facts.

## Rollback boundary

Rollback requires:

1. a valid authenticated owner matching the configured single owner;
2. configured private persistence;
3. explicit owner confirmation;
4. the active batch ID;
5. a meaningful recorded reason;
6. an owner-scoped idempotency key; and
7. a valid request timestamp.

The repository adapter must perform one transaction that:

- locks the active owner/source version;
- verifies the target batch is the active accepted version;
- resolves the latest prior accepted same-owner/source version;
- marks the current version rolled back without deleting it;
- restores the prior version as active;
- retains raw objects, batch metadata and contribution provenance;
- creates one new aggregate-refresh request for the restored source-version
  set; and
- returns the same rollback and refresh IDs for an exact retry.

Not-found, no-longer-active and no-prior-version outcomes do not mutate data.
Every successful rollback returns aggregate status `pending`; old aggregate
completion cannot be carried forward.

## Privacy and safety

The service uses opaque IDs and a reason only. It does not receive raw rows,
filenames, source values, wallet details or economic records. Routine logs must
remain redacted, while exact evidence remains available through the
authenticated owner workspace.

Rollback is recoverable source-version selection, not source deletion. Explicit
raw-object deletion remains a separate client-controlled workflow.

## Deferred work

The Neon transaction adapter, completion/rollback UI, aggregate worker, real
private source execution, provider secrets and Gate B evidence remain later
focused work. Production remains fail-closed under Gate F.
