# Phase 5 Maiden Workspace

Status: owner-scoped read boundary staged; commitments, providers and deployment
remain disabled.

## Purpose

The private Maiden route reads compact, materialized allocation evidence only
after the authenticated Clerk owner matches the server-side allowlist. It does
not scan raw Race Merge history on a routine request.

## Preserved rules

- Current Vault `me=true` means Maiden tournament eligible; ownership and ME
  remain separate facts.
- The Current Vault is a replacement snapshot. It cannot establish historical
  entitlement at an earlier race or tournament.
- Allocation considers the strongest credible mode-specific opportunity across
  Bike, Car and Horse rather than the first available event.
- At most one Maiden opportunity may be provisionally selected per core, and
  configured bracket capacity remains binding.
- Preserve-ME, incomplete, stale, uncertain and unavailable evidence cannot
  become a commitment.
- Every allocation remains experimental and non-actionable while Gates C and D
  are unpassed.

## Fail-closed boundary

The application service rejects mismatched owners, malformed timestamps,
orphaned candidates and any allocation payload that violates the Phase 5
contract. The default repository is unconfigured, so no provider initializes at
module import or build time.

Entitlement mutation, tournament entry, live-field claims, Preview activation
and Production activation remain unavailable.
