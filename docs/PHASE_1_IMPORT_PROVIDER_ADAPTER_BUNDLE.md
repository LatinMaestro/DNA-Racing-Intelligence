# Import Provider Adapter Bundle

## Purpose

Define one server-only readiness and lazy-initialization boundary for the
owner-scoped import providers required by the staged Data Updates workflow.

The bundle covers:

- persistence;
- private object storage;
- preview queue;
- background queue;
- approved capacity gate.

## Controls

- Resolve the authenticated owner and server-side allowlist before returning a
  usable bundle.
- Deny a non-owner before any provider factory executes.
- Report every missing adapter in deterministic order.
- Do not initialize any configured adapter while another required adapter is
  unavailable.
- Bind every factory to the verified owner ID.
- Initialize each adapter lazily on first use and reuse the same promise for
  concurrent or replayed access.
- Preserve a sanitized failed initialization and require an explicit later
  request lifecycle for retry rather than creating duplicate provider clients.

## Evidence boundary

This contract does not provision providers, read secrets, connect to a database,
open object storage, dispatch queue work or implement row-level security by
itself. Concrete persistence adapters must still prove forced owner RLS and
idempotent repository operations. The existing guarded import services remain
authoritative for capacity, checksum, preview, confirmation, activation,
processing, aggregate and recovery behaviour.

The browser-side incremental SHA-256 implementation is intentionally outside
this server-only bundle. It remains an independent reviewed client capability
and cannot receive a server owner ID, database client, storage credential or
queue service.

All adapters remain unavailable in the application until separate concrete
provider implementations, the client hasher and their synthetic
isolation/idempotency evidence are reviewed. Preview imports and Production
remain disabled.
