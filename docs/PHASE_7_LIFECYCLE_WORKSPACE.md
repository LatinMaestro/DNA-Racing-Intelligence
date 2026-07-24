# Phase 7 Lifecycle Workspace

Status: owner-scoped read boundary staged; execution, providers and deployment
remain disabled.

## Purpose

The private Lifecycle route reads compact, materialized action evidence only
after the authenticated Clerk owner matches the server-side allowlist. It does
not scan raw race, lineage, breeding or ledger history on a routine request.

## Preserved rules

- Racing, Discovery, Maiden, breeding, lineage and market evidence remain
  distinct inputs.
- Missing, partial, stale or protected evidence holds every action rather than
  becoming a negative value.
- Genesis cores can never be burned.
- Eligible-no-star and Gold-ineligible-no-star evidence cannot support burn by
  itself.
- Sale and burn remain strategic review labels, never executable actions.
- Actual BGC burn credit is excluded from ranking so it cannot manufacture a
  disposal case.
- Source facts and ledger records are immutable at this boundary.

## Fail-closed boundary

The application service rejects mismatched owners and any payload that violates
the Phase 7 ranking contract, including duplicate cores, incomplete action sets
or malformed evidence. The default repository is unconfigured, so no provider
initializes at module import or build time.

Final recommendations, sale, burn, ledger mutation, Preview activation and
Production activation remain unavailable.
