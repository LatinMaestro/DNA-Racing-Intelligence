# Phase 2A manual ledger write service

## Scope

This provider-neutral service validates owner-entered economic evidence before a
durable write and adds idempotent, append-only reversal handling. No form,
database provider, Preview route or Production setting is activated by this
slice.

## Entry recording

- The authenticated Clerk owner must match the server-side allowlist before
  validation or repository access.
- The existing manual-ledger domain remains authoritative for category,
  subcategory, exact decimal, account, asset, BGC, tournament, cost-basis and
  linked-core validation.
- The validated entry receives a SHA-256 fingerprint over its deterministic
  canonical projection.
- A new durable entry ID records once.
- Repeating the same durable entry ID and fingerprint is an idempotent replay.
- Reusing an entry ID with different evidence is a blocking conflict.
- Incomplete evidence, including unknown core-sale cost basis or unallocated
  tournament payout, retains the domain warning and never becomes complete.

## Reversal recording

- A reversal must identify an accepted original entry, include a durable
  reversal ID, valid timestamp and non-empty reason.
- The reversal cannot predate the original entry.
- Every original posting receives one exact opposite posting in the same
  account and original asset.
- Operating classification is preserved so aggregates can unwind the original
  recorded activity correctly.
- The original entry and source facts remain immutable.
- Replaying the same reversal fingerprint is idempotent; conflicting reuse of a
  reversal ID blocks.

This model preserves separate ETH, DEZ, fiat and BGC ledgers. It does not assign
cash value to BGC, combine assets or turn transfers into operating profit.

## Safety boundary

The default repository is `not_configured`. The service returns a fail-closed
state when identity or persistence is unavailable and exposes no wallet
connection, signing key, automatic transaction, provider initialization or
Production action.

## Hosted validation

The focused slice passes Prettier, ESLint, strict TypeScript and six synthetic
tests covering fail-closed identity/persistence, owner denial, validated exact
recording, idempotent replay, durable-ID conflict, exact BGC reversal, immutable
source facts, missing originals and chronological rejection.
