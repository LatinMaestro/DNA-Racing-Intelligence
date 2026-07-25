# Phase 6 Breeding Economic Write Service

## Scope

This provider-neutral service records owner-confirmed completed breeding economics
and optional offspring cost-basis assignments through the existing exact domain
contracts.

## Controls

- Clerk owner evidence must match the configured server-side owner before any
  repository read or write.
- Canonical SHA-256 fingerprints normalize timestamps, durable IDs, original
  asset codes, exact decimals, references and transaction ordering.
- Identical durable-ID replay is idempotent; different evidence under the same
  ID fails closed.
- Only completed or refunded transaction evidence reaches persistence. Arena
  listings, pending activity and incomplete evidence remain held.
- Offspring cost-basis duplicate checks come from owner-scoped persistence, not
  a browser request.
- An existing exact assignment replays before duplicate lookup, avoiding a false
  conflict with its own already-assigned transactions.
- Actual costs and refunds remain separated by original asset. BGC remains a
  game credit and is never combined with crypto or fiat.
- Cost basis requires a confirmed completed breeding event, a confirmed owned
  offspring and confirmed actual cost evidence.
- The service never infers completed income, market value or realised gain and
  cannot initiate a splice, wallet transaction, ledger mutation or ownership
  change.

## Deferred

Concrete persistence adapters, authenticated forms, provider configuration,
private Preview execution and Production remain disabled and separately gated.
