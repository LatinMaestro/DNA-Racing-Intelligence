# Phase 1 Guarded Import Activation Service

## Purpose

This service advances an authenticated owner from an accepted preview to one
durable background-processing reservation. It does not upload files, process
rows, activate a dataset or initialise a provider by itself.

The implementation is provider-neutral and unavailable by default. Preview and
Production remain fail-closed until every required private capability is
configured and the relevant repository gates pass.

## Trust boundary

The browser submits only opaque confirmation references:

- persisted preview ID;
- SHA-256 preview fingerprint;
- idempotency key; and
- explicit confirmation.

The browser's copy of the preview is never authoritative. A persistence adapter
must atomically revalidate that the persisted preview belongs to the owner,
still has the same fingerprint, remains confirmable, and has not been superseded.

The server independently requires:

1. authenticated Clerk user ID matching the configured single owner;
2. an approved-capacity decision before paid or oversized work;
3. private raw-storage attestation for every staged object;
4. an owner-scoped durable processing reservation; and
5. an idempotent private background queue.

Opaque reservation IDs and enum states returned by persistence are validated
before queue dispatch or owner-facing results. Malformed persistence evidence
fails closed.

Missing identity returns a disconnected state. A different identity is denied
before infrastructure is inspected. Missing infrastructure keeps activation
unavailable and reports the exact absent capabilities.

## Ordering and idempotency

Activation occurs in this order:

1. verify owner identity;
2. validate the opaque confirmation fields;
3. approve capacity;
4. attest the staged raw uploads and preview fingerprint;
5. reserve the update session and dispatch ID durably;
6. enqueue the dispatch using that stable dispatch ID; and
7. mark the durable reservation queued.

Repeating the same owner-scoped idempotency key returns the existing queued
reservation without creating or dispatching another job. Queue adapters must
also deduplicate by dispatch ID so a retry after an uncertain response cannot
create duplicate processing.

If enqueueing fails, the reservation is marked with a retryable dispatch failure
and the error is returned. No source version is activated on this path. The
previous accepted dataset remains current until a later background transaction
finishes validation and activation.

## Pre-dispatch confirmation cleanup

Synthetic and abandoned confirmation reservations may be removed only before
queue dispatch. The cleanup boundary requires the exact authenticated owner,
upload request fingerprint, prepared-preview ID and fingerprint, update session
ID and activation dispatch ID. It accepts only an undispatched `pending`
activation reservation and rejects queued, failed, processing or accepted work.

The reservation removal and existing pre-activation source cleanup execute in one
database transaction. Successful cleanup records both the original
pre-activation cleanup receipt and a confirmation-cleanup receipt containing the
opaque reservation identity and bounded source counts. Exact replay is
idempotent. This boundary is not a substitute for versioned rollback after any
source version has been activated.

## Data and logging

The activation service receives no file contents, filenames, row values,
economic values or derived owner records. Provider adapters may use the opaque
owner, preview, session and dispatch identifiers but routine logs must remain
redacted.

Original files and analytically relevant source values remain preserved inside
the separately gated private raw-data boundary. This service does not weaken
that retention requirement.

## Deferred work

This slice does not:

- provision Clerk, Neon, object storage or a queue;
- implement a large-file HTTP upload route or direct-upload grant;
- expose the confirmation-cleanup boundary through a provider adapter or owner-facing route;
- process, validate or materialise rows;
- refresh aggregates;
- implement completion reporting or versioned rollback; or
- enable Preview or Production.

Those capabilities remain focused later slices and require their own synthetic,
hosted and exact-head evidence.
