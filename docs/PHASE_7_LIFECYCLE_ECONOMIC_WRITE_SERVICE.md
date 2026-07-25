# Phase 7 Lifecycle Economic Write Service

## Scope

This provider-neutral service records owner-confirmed lifecycle economic
evidence after server-side owner verification. It composes the existing core
sale, core burn and actual burn-credit reconciliation contracts without
executing game or wallet actions.

The repository adapter remains unavailable by default. This slice does not
provision persistence, expose a form, activate Preview or change Production.

## Sale evidence

- Validate completed sale evidence, active ownership at sale time, exact
  proceeds, exact selling fees and optional acquisition cost.
- Preserve every original asset. Unlike-asset cost basis cannot produce a
  realised result.
- Missing cost basis leaves proceeds visible and realised gain/loss
  unavailable.
- Persist one canonical SHA-256 fingerprint per durable sale ID. Exact replay is
  idempotent and conflicting evidence fails closed.
- Strategic lifecycle advice is never execution evidence and no market value is
  inferred.

## Burn evidence

- Permanently reject Genesis burns.
- Record confirmed completed Morphed, Freak or X-Class burn evidence for review.
- Preserve historical lineage and project active-Vault removal only as a later
  reviewed persistence action.
- Do not execute a burn, mutate ownership, predict a burn credit or create a
  ledger posting from the burn event.
- Persist one canonical SHA-256 fingerprint per durable burn ID.

## Actual BGC burn credit

- Require one durable stored burn ID and matching authoritative core ID.
- Accept only exact positive BGC evidence after the burn time.
- Reconcile the candidate with existing credits for the same burn.
- One confirmed direct match may propose a separate BGC-ledger posting.
- Multiple, provisional, conflicting, unlinked or mismatched credits remain
  review-required and produce no posting proposal.
- Exact credit replay is idempotent; conflicting durable credit identity fails
  closed.
- The service never predicts a credit amount or combines BGC with cash/crypto
  profit.

## Security and activation boundary

- Clerk owner evidence must match the configured server-side owner before any
  repository read or write.
- The browser cannot supply owner authority, execution proof or an existing burn
  record.
- Repository methods are owner-scoped and must atomically enforce durable-ID
  uniqueness when a provider adapter is implemented.
- No raw exports, private records, credentials, wallet actions, game actions or
  Production changes are introduced.

## Verification

Synthetic tests cover fail-closed identity and persistence, exact sale
arithmetic, missing cost basis, durable replay/conflict handling, Genesis burn
rejection, non-mutating spliced-core burn evidence, matching BGC credits,
multiple-credit review, exact credit replay and missing/mismatched burn
evidence.
