# Phase 6 Breeding Economic Actions

## Status

This Server Action boundary is staged and disabled. It does not connect
persistence, infer a completed breeding from an Arena listing, assign market
value, call a wallet or game system, mutate ownership or change Production.

## Contract

- Resolve Clerk identity inside every action invocation and compare it with the
  configured single-owner allowlist before persistence access.
- Never accept an owner identifier from the browser.
- Delegate completed/refunded breeding evidence and optional offspring
  cost-basis requests to the existing validated write service.
- Preserve original assets separately. BGC remains game credit and cannot be
  combined with cash or crypto.
- Keep Arena listings as non-transaction evidence.
- Keep duplicate transaction use, incomplete evidence, unknown ownership and
  non-completed breeding events held for review.
- Never assign market value or calculate realised gain from a proposed cost
  basis.
- Return `persistence_not_configured` until an owner-scoped forced-RLS
  repository is deliberately connected and validated.

## Remaining evidence

- Add a disabled accessible form shell with explicit completed/refunded evidence
  and cost-basis review states.
- Add strict `FormData` parsing and server-generated durable IDs only when the
  write repository is connected.
- Exercise record, replay, conflict, hold and duplicate-assignment paths against
  persistent Preview storage before Gate E.
