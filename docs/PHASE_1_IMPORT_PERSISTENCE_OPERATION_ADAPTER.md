# Import Persistence Operation Adapter

## Purpose

Define the owner-scoped transaction and durable-operation boundary required
behind the staged import provider bundle. The boundary is provider-neutral and
does not provision or connect to PostgreSQL.

## Transaction controls

- Validate the configured database owner UUID and authenticated Clerk identity
  before initializing a persistence driver.
- Initialize the injected driver lazily and reuse one owner-bound instance.
- Begin one transaction for each operation reservation.
- Establish a transaction-local owner scope before any owner verification or
  operation query.
- Require the database to echo the exact owner scope.
- Verify the database-owner and Clerk-user binding inside the same transaction.
- Require both row-level security and forced row-level security evidence before
  reserving an operation.
- Roll back the transaction after any scope, identity, RLS, result-shape or
  idempotency failure.

## Idempotency controls

Supported durable operation kinds cover upload intake, upload completion,
preview dispatch, confirmed activation, recovery and aggregate-refresh retry.
Every reservation carries:

- the database owner UUID;
- one canonical operation kind;
- a bounded idempotency key;
- an exact lowercase SHA-256 request fingerprint; and
- a canonical UTC timestamp.

An existing reservation is a replay only when its stored fingerprint exactly
matches. A reused idempotency key with different evidence fails closed and the
transaction rolls back.

## Evidence boundary

Synthetic tests prove call ordering, fail-closed owner isolation, forced-RLS
requirements, rollback and exact replay semantics at the adapter boundary.
They do not claim that a live database has the required policy or operation
table. The concrete Neon driver, reversible schema verification and persistent
Preview execution remain separately gated.

No connection string, provider credential, private source file, source row or
Production capability is present. The application bundle remains unavailable.
