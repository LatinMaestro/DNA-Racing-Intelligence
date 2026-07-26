# Phase 1 Neon Import Persistence Driver

## Scope

This boundary supplies the concrete Neon transaction driver and reversible schema
required by the provider-neutral import persistence operation adapter.

It remains disabled unless a server-only database URL is deliberately supplied.
Import routes, Preview imports, provider provisioning and Production are unchanged.

## Transaction contract

Each reservation uses one short-lived WebSocket connection and one serializable
PostgreSQL transaction:

1. set `app.owner_id` transaction-locally;
2. verify the database owner matches the authenticated Clerk identity;
3. verify the reservation table has both RLS and forced RLS enabled;
4. reserve the operation by owner, operation kind and idempotency key;
5. commit only when the returned fingerprint matches the request; and
6. roll back and close the connection on every failure.

All dynamic values use query parameters. The Neon driver is imported only when a
configured operation first runs, and the pool is opened and closed inside that
operation.

## Durable reservation schema

Migration `0010_import_operation_reservation` adds:

- one owner-scoped reservation table;
- operation-kind and identifier constraints;
- exact SHA-256 request fingerprints;
- a deterministic durable operation ID;
- owner RLS with `FORCE ROW LEVEL SECURITY`; and
- an idempotent reservation function that preserves the first accepted
  fingerprint for conflict detection.

The migration includes forward, smoke and reverse SQL. The smoke contract covers
exact replay, conflicting replay, cross-owner denial and forced-RLS evidence.

## Validation boundary

Synthetic TypeScript tests execute the complete transaction protocol through an
injected client without a database connection. PostgreSQL apply, smoke and reverse
execution remain pending because the current hosted workspace has no PostgreSQL
runtime and no approved Neon project is connected.

This branch therefore proves application and migration intent, not Gate B database
readiness. Provider configuration, capacity evidence and exact-head CI remain
separate gates.
