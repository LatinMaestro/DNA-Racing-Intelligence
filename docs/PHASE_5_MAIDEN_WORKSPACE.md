# Phase 5 Maiden Workspace

Status: owner-scoped read boundary; commitments, providers and deployment
remain disabled.

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

The default repository is unconfigured, so no provider initializes at module
import or build time. Entitlement mutation, tournament entry, live-field
claims, private-data execution, Preview activation and Production activation
remain unavailable.

## Source identity

This workspace was recomposed from queue order 17 exact source head
`c9b0004f7086c8a4fb489690d3465a701312596b` onto verified `main`
`4748f3e21f0eade849fb69d2ceff99ea497c3217`. No staged precursor, rehearsal
branch, queue ledger or cumulative descendant was merged.
