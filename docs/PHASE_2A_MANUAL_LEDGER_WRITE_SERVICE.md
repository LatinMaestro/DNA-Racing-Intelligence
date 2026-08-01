# Phase 2A manual ledger write service

## Scope

This provider-neutral service validates owner-entered economic evidence before a
durable write and adds idempotent, append-only reversal handling. No form,
database provider, Preview route or Production setting is activated by this
slice.

## Entry recording

- The authenticated Clerk owner must match the server-side allowlist before
  validation or repository access.
- Asset code, kind and decimal precision come from one versioned server-side
  registry. The write requires the version seen by the owner, rejects registry
  drift and rejects caller metadata or amounts that do not match the registry.
- Entry time is canonicalized to UTC and cannot be later than server time.
- The existing manual-ledger domain remains authoritative for category,
  subcategory, exact decimal, account, BGC, tournament, cost-basis and linked
  core validation.
- A tournament ID is not campaign authority. Tournament aggregation remains
  ineligible until owner-acknowledged evidence and the exact tournament
  configuration version resolve from owner-scoped persistence and match the
  submitted versions.
- The validated entry receives a SHA-256 fingerprint over its deterministic
  canonical projection, including registry and campaign binding evidence.
- A new durable entry ID records once through an optimistic ledger-version
  check. Repeating the same durable entry ID and fingerprint is an idempotent
  replay. Reusing an entry ID with different evidence blocks.
- Incomplete evidence, including unknown core-sale cost basis, unallocated
  tournament payout or unbound campaign linkage, retains a warning and never
  becomes complete.

## Reversal recording

- A reversal identifies an accepted original entry, includes a durable reversal
  ID, canonical timestamp and non-empty reason, and cannot predate the original
  or postdate server time.
- The original fingerprint and current asset-registry version must remain exact.
- Every original posting receives one exact opposite posting in the same
  account and original asset. Operating and tournament-aggregation
  classifications are preserved so aggregates can unwind the original without
  widening its authority.
- The repository must atomically compare the expected ledger version, original
  fingerprint and prior-reversal state. One original can be reversed once.
- The original entry and source facts remain immutable. Exact reversal replay is
  idempotent; conflicting reuse of a reversal ID blocks.

This model preserves separate ETH, DEZ, fiat and BGC ledgers. It does not assign
cash value to BGC, combine assets or turn transfers into operating profit.

## Safety boundary

The default repository and asset registry are `not_configured`. The service
returns a fail-closed state when identity, persistence or authoritative asset
metadata is unavailable. It exposes no wallet connection, signing key,
automatic transaction, provider initialization or Production action.

## Validation contract

Synthetic tests cover identity and provider fail-closed states, owner denial,
authoritative registry metadata and precision, registry drift, canonical and
future timestamps, exact decimals, transfer exclusion, BGC isolation, missing
cost basis, owner-acknowledged campaign binding, optimistic concurrency,
idempotent replay, durable-ID conflicts, exact reversals, original fingerprint
checks and duplicate-reversal rejection.
