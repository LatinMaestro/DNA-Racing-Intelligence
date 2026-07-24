# Phase 1 Aggregate Refresh Service

## Purpose

This slice defines provider-neutral orchestration for rebuilding compact
application aggregates after accepted source facts change. It keeps
multi-million-row processing outside routine web requests and prevents an older
refresh from publishing over a newer accepted import.

It does not implement a queue provider, PostgreSQL repository, analytical
worker, real dataset refresh, Preview configuration or Production activation.

## Durable claim

A queue delivery contains only one internal refresh ID. The owner, update
session and exact source-version set are resolved from private persistence.

The repository claims one bounded worker lease and returns one of:

- not found;
- already complete;
- leased elsewhere; or
- claimed with the owner, update session and SHA-256 fingerprint of the exact
  active source-version set.

Missing, completed and concurrently leased work cannot invoke the refresher.
Unsafe identifiers, malformed fingerprints and non-canonical retry timestamps
fail closed.

## Prepared aggregate boundary

The bounded refresher writes only a prepared aggregate set. Its result includes:

- an internal prepared-set ID;
- the source-version-set fingerprint;
- a positive aggregate-family count; and
- a non-negative materialized-row count.

The service rejects a prepared result whose source-version fingerprint differs
from the durable claim. This prevents a worker from publishing calculations
based on another owner or dataset generation.

## Atomic publication

The repository publishes the prepared set inside an owner-scoped transaction.
It must compare the claimed fingerprint with the source versions that are active
at publication time.

- If they still match, the repository atomically marks the aggregate set active
  and records completion.
- If a newer accepted import has changed the active set, the refresh is
  `superseded`. It is not a failure, but it cannot update aggregate completion,
  freshness or recommendation readiness.
- A computation or publication failure records retryable evidence and cannot
  claim completion.

Routine application reads must continue using the last completely published
aggregate set. They must not use a partly prepared set or imply that newly
accepted source data has refreshed recommendations before publication succeeds.

## Validation

Synthetic tests cover:

- not-configured, missing, complete and concurrently leased states;
- bounded claim and exact prepared/publication inputs;
- successful atomic publication;
- supersession by a newer active source set;
- prepared fingerprint mismatch;
- computation and publication failures; and
- invalid identifiers, leases and result counts.

The repository adapter, SQL transaction, queue/worker provider, representative
private-data refresh and capacity evidence remain later focused slices. These
synthetic tests cannot accept Gate B, Gate C or Gate F.
