# Phase 2A Manual Tournament Payout Write Service

## Purpose

This focused slice provides the owner-scoped application boundary for recording
an external tournament prize and resolving possible duplication against
imported race payouts. It recomposes queue order 23 from exact source head
`0a5b38f46ab9881f7367a48de94ed62a40659e1e` onto the current verified `main`
without importing staged ancestry. The two required deterministic allocation
and reconciliation domains are included because neither existed on that base.

The repository remains unavailable by default. This slice does not configure a
provider, enable a form, mutate Preview or Production, or initiate a wallet or
game action.

## Write contract

- Require the authenticated Clerk owner to equal the configured server-side
  owner ID before any economic repository read or write.
- Load an owner-scoped, persisted tournament campaign binding. Free text cannot
  authorize campaign totals: tournament ID, owner-acknowledged evidence ID and
  exact configuration version must agree and remain authoritative at decision
  time.
- Derive asset code, kind and precision from a versioned server-side registry.
  Reject caller metadata mismatch, BGC, excess precision, ambiguity and
  registry-version drift.
- Preserve original-asset amounts as exact base-10 values. Genuine vault-level
  prizes may remain unallocated; single-core, equal, manual-amount,
  manual-percentage and documented-points allocations conserve exact atoms.
- Canonicalize timestamps to UTC and reject future payouts, acknowledgements,
  imported candidates and decisions.
- Bind creation to an expected ledger version. Canonical state fingerprints
  make exact durable-ID replay idempotent and reject changed evidence.

## Candidate evidence and reconciliation

The owner-scoped repository returns at most 250 same-context imported payout
candidates plus the active import-snapshot hash and candidate-set hash. The
service independently canonicalizes and sorts the candidates and recomputes the
SHA-256 candidate-set hash over the exact snapshot, bounded query and candidate
records. Creation requires exact agreement with the owner's expected snapshot
hash, candidate-set hash and complete ordered transaction-identity set.

Potential duplicates remain included and `review_required`; imported facts are
immutable and no automatic exclusion is allowed. A reasoned owner decision may:

- confirm a detected, currently included imported candidate as the duplicate,
  excluding only the manual payout from aggregates; or
- confirm the manual and imported payouts as separate, retaining both.

Every decision reloads the current candidate set, revalidates the stored
campaign and asset-registry evidence, verifies the stored-state fingerprint and
uses an exact optimistic reconciliation revision. If the active import snapshot,
candidate-set hash or expected candidate identities changed, persistence must
atomically reopen review and keep the manual payout included. The same
fail-closed result applies when drift is detected during the decision write;
that atomic result must return its bounded candidate set, which is independently
canonicalized and re-hashed before the reopened snapshot and candidate hashes
are reported.
The stored ledger version and last-operation fingerprint make a lost-response
retry replay the exact decision or review reopening without a second mutation;
changed payloads and genuinely stale revisions remain blocked.

## Provider and privacy boundary

This slice adds no Neon adapter or migration, route, form, credential, provider
configuration, wallet address, transaction row or private derived result.
Routine results contain only bounded counts, internal identities and hashes.
Preview remains unprotected and tableless; Production remains untouched.

## Synthetic verification

Focused tests cover exact allocation conservation, authoritative assets,
campaign acknowledgement, identity denial before repository access, bounded and
hash-valid candidate evidence, imported-fact immutability, idempotent replay,
ledger/revision conflicts, stored-state tampering, reasoned decisions, future
evidence rejection and review reopening after pre-write or concurrent candidate
drift. Synthetic fixtures cannot establish private accounting completeness or
accept Gate C.
