# Phase 1 Import Confirmation Action

## Scope

This slice adds the authenticated server-only action boundary for explicitly
confirming one persisted import preview and delegating to the existing guarded
activation service. It does not connect persistence, raw storage, capacity or
queue providers.

## Contract

- Resolve Clerk identity inside every confirmation request.
- Never accept an owner ID from the browser.
- Require the authenticated owner to match the server-side allowlist before any
  persistence, raw-object, capacity or queue access.
- Accept only a durable preview ID, its persisted SHA-256 fingerprint, an
  idempotency key and explicit owner confirmation.
- Re-run the approved capacity and private-upload readiness checks at the
  guarded activation boundary.
- Reserve one durable update session and dispatch idempotently before enqueue.
- Preserve queued replay and sanitized dispatch-failure behaviour from the
  activation service.
- Return an explicit list of unavailable capabilities when provider adapters
  are not configured.

## Disabled boundaries

All four activation capabilities remain unavailable in the Next.js Server
Action adapter. This slice cannot query a preview, inspect an object, approve
capacity, enqueue processing, activate a source version, refresh aggregates or
change Preview or Production.

The browser cannot supply a preview body, owner identity, active source version,
freshness value or recommendation state.

## Validation

Synthetic tests cover signed-out and non-owner rejection, unavailable
capabilities, missing explicit acknowledgement and exact authenticated
delegation to the guarded activation service. No real preview, filename, source
record, credential or provider is used.
