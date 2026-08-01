# Phase 7 Lifecycle Economic Write Service

## Purpose

This slice provides owner-scoped application boundaries for recording confirmed
core-sale evidence, confirmed burn evidence and an actual BGC burn credit. It
keeps strategic lifecycle advice, execution evidence, ownership review and
economic posting as separate auditable stages.

## Core sale

- Require the authenticated Clerk owner before persistence.
- Validate completed-sale evidence through the existing exact-asset domain.
- Resolve asset kind and precision from one authoritative server-side registry,
  bind the record to its exact registry version and reject registry drift.
- Preserve proceeds and selling fees in their original assets.
- Calculate realised result only when a same-asset acquisition cost is known.
- Keep proceeds visible while cost basis is missing or unlike assets prevent a
  realised calculation.
- Never infer market value, execute a sale or mutate ownership.

## Core burn

- Reject Genesis burn evidence permanently.
- Require confirmed completed evidence and confirmed active ownership before
  projecting a reviewed active-Vault removal.
- Retain historical lineage.
- Keep lifecycle recommendations distinct from execution evidence.
- Predict no BGC amount and perform no ownership or ledger mutation.

## Actual BGC credit

- Require one durable burn ID and load its owner-scoped stored evidence.
- Verify the stored burn fingerprint before using it as reconciliation evidence.
- Require the credit core to match the referenced burn.
- Accept only exact positive BGC game-credit evidence within authoritative
  precision.
- Reconcile the new credit together with existing credit evidence for the same
  burn.
- Propose one ledger posting only when exactly one confirmed credit directly
  references the confirmed burn and core after the burn time.
- Keep multiple, provisional, mismatched or otherwise ambiguous credits in
  review.
- Never predict a credit, auto-exclude evidence or mutate the burn.

## Durable writes

Every accepted sale, burn or credit record is canonicalised and fingerprinted
with SHA-256. Persistence receives an expected lifecycle version; concurrent
version drift fails closed. Exact durable-ID replay is idempotent and
conflicting evidence under the same identity fails closed.

Event and recorded timestamps are canonical UTC values derived at the service
boundary. Future evidence relative to server time is rejected.

The provider-neutral repository is unavailable by default. This slice adds no
form, Neon mutation adapter, wallet/game action, Preview data change or
Production activation.

## Synthetic verification

Focused tests cover owner and persistence gates, exact sale result, missing and
unlike cost basis, confirmed burn evidence, Genesis rejection, actual BGC
credit reconciliation, ambiguous credits, missing burns, exact replay, durable
ID conflict, registry drift, asset precision, optimistic concurrency and future
evidence.

All outputs remain review evidence. Synthetic tests do not establish complete
economic coverage or accept Gate C.
