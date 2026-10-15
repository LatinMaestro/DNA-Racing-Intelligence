# Phase 5 Maiden Workspace

Status: compact owner-scoped snapshot persistence and route read adapter are
implemented with synthetic migration/fixture coverage; source materialization,
connected acceptance, commitments and deployment remain disabled.

## Purpose

The private Maiden route reads compact, materialized allocation evidence only
after the authenticated Clerk owner matches the server-side allowlist. It does
not scan raw Race Merge history on a routine request.

## Preserved rules

- Current Vault `me=true` is only a current eligibility snapshot; ownership and
  ME remain separate facts, and the snapshot cannot prove historical
  entitlement at an earlier race or tournament.
- Entering a qualification race commits the core for that event. Planned,
  committed, consumed, unavailable, unknown and invalid lifecycle evidence is
  therefore never presented as allocatable.
- Allocation compares the strongest credible mode-specific opportunity across
  Bike, Car and Horse rather than the first available event. Incomplete
  cross-mode evidence fails closed.
- At most one Maiden opportunity may be provisionally selected per core, and
  configured bracket capacity remains binding.
- Time evidence leads the projection. Strong or competitive time evidence is
  required; stars remain displayed supporting context and cannot override weak
  or unknown time evidence.
- Tournament configuration, candidate snapshot and projection versions are
  bound end-to-end and shown in the review surface.
- Preserve-ME, incomplete, stale, uncertain and unavailable evidence cannot
  become a provisional allocation.
- Every allocation remains experimental and non-actionable while Gates C and D
  are unpassed.

## Fail-closed boundary

The application service rejects mismatched owners, malformed or non-canonical
timestamps, future imports, future or post-import cutoffs, orphaned candidates
and any allocation payload that violates the contract. It derives freshness
from the accepted cutoff and server time instead of trusting persisted labels,
including exact 3/4/7/8-day boundary coverage. Without an accepted import,
freshness is unknown and candidates are deferred.

The route composes a repository only when its complete server-side database,
database-owner, runtime-role and authenticated-owner environment exists. The
repository opens one repeatable-read, read-only transaction, applies short
statement/lock timeouts, proves forced RLS and least privilege, and calls one
bounded function returning at most one 512 KiB canonical snapshot. Missing
configuration performs no provider access; missing materialization returns an
explicit connected-but-empty state. Provider failures are sanitized.

The snapshot table is forced-RLS, owner-keyed and inaccessible directly to the
runtime role. Its envelope binds the database owner, accepted source-evidence
SHA-256, materialization time, canonical body checksum and exact evidence
schema. No runtime write or publication function exists in this slice, so the
route cannot build evidence, traverse raw history or mutate last-good state.
Entitlement mutation, tournament entry, live-field claims, connected
private-data acceptance, Preview activation and Production activation remain
unavailable.

## Authority-to-interface traceability

| Boundary         | Preserved authority                                                                                                    | Implementation and proof                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Method           | One-use ME; whole-Vault Bike/Car/Horse comparison; time-led projection; stars supporting only; no commitment           | `domain/maiden-vault-allocation.ts`; existing domain/service tests           |
| Compact evidence | Exact versions, chronology, owner/source binding, deterministic order and 512 KiB bound                                | `lib/maiden-allocation-evidence-snapshot.ts`; codec tests                    |
| Persistence      | One owner row, forced RLS, no runtime table privilege, checksum/source/envelope constraints                            | migration `0127`; apply/smoke/reverse/removal CI                             |
| Repository       | Authenticated/configured owner equality, least-privilege proof, one bounded read, canonical decode, sanitized failures | `lib/neon-maiden-allocation-repository.ts`; deterministic fake-session tests |
| Website          | Existing service re-derives freshness and invokes the unchanged allocator; missing snapshots stay non-actionable       | private Maiden route plus existing workspace tests                           |

The remaining gap is a source-authoritative materializer/publication path that
derives the already-approved bracket/candidate inputs, validates complete
cross-mode coverage, atomically replaces last-good only after full validation,
and invalidates corrected source generations. It must not invent projection
weights, probabilities or tournament economics.

## Source identity

This workspace was recomposed from queue order 17 exact source head
`c9b0004f7086c8a4fb489690d3465a701312596b` onto verified `main`
`4748f3e21f0eade849fb69d2ceff99ea497c3217`. No staged precursor, rehearsal
branch, queue ledger or cumulative descendant was merged.
