# Phase 4 Tournament Workspace

Status: owner-scoped read boundary staged; mutations, providers and deployment
remain disabled.

## Purpose

The private Tournaments route reads compact, materialized candidate evidence
only after the authenticated Clerk owner matches the server-side allowlist. It
does not scan raw Race Merge history on a routine request.

## Preserved rules

- Tournament and bracket rules are versioned configuration, never hardcoded
  from historical exports.
- Candidate order follows the configured qualification metric. Historical
  stars may explain evidence but cannot determine the order.
- Imported history is a historical snapshot, not the current qualifying field.
- The 50% race-gate rule is a hard cap, not a target.
- Maiden eligibility is preserved for the strongest projected mode-specific
  opportunity.
- Unknown or missing evidence is unavailable, never favourable or zero.
- Every candidate remains experimental and non-actionable while Gate C is
  unpassed.

## Fail-closed boundary

The application service rejects mismatched owners, duplicate
tournament/bracket records, malformed timestamps and any candidate payload
that violates the Phase 4 ranking contract. The default repository is
unconfigured, so no provider initializes at module import or build time.

Tournament entry, automatic allocation, live-field claims, Preview activation
and Production activation remain unavailable.
