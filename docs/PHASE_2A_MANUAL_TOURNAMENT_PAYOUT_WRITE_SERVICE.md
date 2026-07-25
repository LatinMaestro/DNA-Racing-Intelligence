# Phase 2A Manual Tournament Payout Write Service

## Purpose

This slice provides the owner-scoped application boundary for recording an
external tournament prize and resolving possible duplication against imported
race payouts. It composes the existing exact payout-allocation and conservative
reconciliation domains without configuring a provider, enabling a form or
changing Production.

## Write contract

- Require the authenticated Clerk owner to match the configured server-side
  owner ID before any economic repository read or write.
- Validate the payout through the existing exact-decimal tournament-payout
  domain.
- Preserve the original asset and reject BGC, which remains in its separate
  game-credit ledger.
- Permit genuine vault-level prizes to remain unallocated.
- Preserve exact single-core, equal, manual-amount, manual-percentage and
  documented-points allocations.
- Query only bounded same-context imported prize candidates through an
  owner-scoped repository.
- Record possible duplicate evidence as review-required without automatically
  excluding either payment.
- Fingerprint the canonical payout plus reconciliation state with SHA-256.
  Exact durable-ID replay is idempotent; different evidence under the same ID
  is a conflict.

## Reconciliation decisions

An accepted payout can later receive one reasoned decision:

- `confirmed_duplicate` excludes the manual payout from aggregates while
  retaining the imported payout and all evidence unchanged; or
- `confirmed_separate` keeps the external prize included alongside the imported
  payout.

The service reloads the owner-scoped imported candidates and re-runs the
conservative reconciliation contract before accepting a decision. It requires
an exact optimistic revision, normalized decision timestamp and non-empty
reason. A duplicate decision can reference only a currently included detected
candidate.

Imported facts are immutable, suspected duplicates never auto-exclude, and all
decision writes use a deterministic fingerprint for retry-safe replay.

## Provider boundary

The repository is unavailable by default. This slice does not add:

- a Neon write adapter or migration;
- a browser form or route;
- wallet or blockchain functionality;
- provider configuration or secrets;
- Preview data mutation; or
- any Production change.

Those remain later focused and gated slices.

## Synthetic verification

Focused tests cover:

- disconnected identity and unavailable persistence;
- owner mismatch before candidate access;
- exact asset-separated allocation persistence;
- duplicate-review creation;
- idempotent replay and durable-ID conflict;
- reasoned duplicate and separate-payment decisions;
- immutable imported facts;
- missing payout, stale revision and invalid candidate rejection; and
- BGC exclusion.

Synthetic evidence cannot establish dependable Vault Performance totals or
accept Gate C.
