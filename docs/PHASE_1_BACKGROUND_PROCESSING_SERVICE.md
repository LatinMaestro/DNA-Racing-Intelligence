# Phase 1 Background Processing Service

## Purpose

The background service consumes one durable dispatch created by the guarded
activation service. It establishes retry and concurrency semantics around the
future streaming processor without provisioning a worker or handling real
private files in the repository workspace.

## Claim and lease

Every queue delivery carries only a stable dispatch ID. The processing
repository resolves the owner, update session and persisted preview fingerprint
inside its private boundary.

Before any processor work, the repository atomically returns one of:

- not found;
- already complete;
- leased by another worker with a canonical retry time; or
- claimed with an owner-scoped lease.

Worker and dispatch identifiers are bounded opaque values. A lease must be
positive and cannot exceed one hour. Missing, completed and concurrently leased
dispatches never invoke the processor.

## Preparation and activation

The bounded processor receives the claimed owner, update session, dispatch and
preview fingerprint. It returns only an opaque prepared-result ID plus compact
counts and whether aggregate refresh is required.

The repository validates and activates that prepared result in its own
owner-scoped transaction. Provider implementations must ensure:

- the prepared result belongs to the same owner, session, dispatch and preview;
- accepted source versions activate only after their validation transaction
  succeeds;
- quarantined records cannot replace accepted facts;
- exact replay remains idempotent;
- the previous accepted source version remains current on preparation failure;
- aggregate refresh is marked pending whenever accepted facts change; and
- recommendations do not report readiness until refresh completes.

The service does not pass raw rows, filenames, economic values or source objects
through routine logs.

## Retry behaviour

Processor failure is recorded against the claimed dispatch and worker without
calling activation. A later eligible delivery may claim the work again.

An already completed delivery returns its existing session without rerunning
the processor. Activation adapters must also be idempotent by dispatch and
prepared-result ID to tolerate uncertain network responses.

## Deferred provider work

This contract does not implement:

- queue delivery or worker hosting;
- raw-object streaming;
- schema detection, row normalization or conflict quarantine;
- database write queries or migrations;
- aggregate refresh execution;
- completion UI, rollback UI or notifications;
- provider secrets or paid capacity; or
- Preview or Production activation.

All remain gated focused slices. Synthetic verification establishes contract
behaviour only and is not Gate B evidence.
