# Phase 1 Import Provider Capacity Adapter

## Status

This boundary is staged and disabled. It does not connect provider APIs, reserve
paid capacity, upload a private source, activate a preview or change Production.

## Contract

- Bind one lazy capacity port to the authenticated owner before any provider
  measurement.
- Check capacity before upload reservation and recheck it from the exact
  persisted preview immediately before activation.
- Require fresh provider API measurements and operation-specific projections for
  all of:
  - R2 retained storage bytes;
  - R2 Class A operations;
  - R2 Class B operations;
  - Neon retained storage bytes; and
  - queue backlog messages.
- Keep approved limits and minimum reserved headroom in reviewed configuration,
  not hardcoded product logic. A missing, stale, future, duplicate, malformed or
  incomplete measurement fails closed.
- Stop when current usage plus the projected increment would cross the usable
  limit after reserved headroom. The adapter cannot opt into a paid tier.
- Capacity approval does not replace schema, checksum, private-bucket, RLS,
  queue-consumer, bounded-memory or exact-head validation.

## Remaining evidence

- Connect read-only usage and projection ports for the approved Preview
  providers without exposing credentials.
- Recheck current published free allowances and record the reviewed
  configuration date.
- Exercise upload and activation projections using sanitized representative
  multi-million-row evidence at least three times against one exact head.
- Record actual R2 operations/storage, Neon storage, queue backlog, request p95
  and worker peak memory before Gate B or the relevant Phase 9 capacity evidence
  can pass.
