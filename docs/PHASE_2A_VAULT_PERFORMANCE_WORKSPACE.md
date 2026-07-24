# Phase 2A Vault Performance Read Workspace

## Purpose

Expose an accepted owner-scoped materialized economic summary through the
private application without scanning raw ledger rows on a routine request. This
slice is read-only and does not enable manual entries, wallet access, imports,
provider provisioning, Preview or Production.

## Application boundary

- Verify the authenticated Clerk user against the server-only owner allowlist
  before persistence.
- Return explicit identity-disconnected and persistence-not-configured states.
- Load at most one compact materialized summary for the verified owner.
- Reject invalid periods, timestamps, counts, completeness claims, asset
  identities, non-canonical exact decimals and duplicate assets.
- Keep provider creation lazy and server-only.

## Reporting boundary

- Show ETH, DEZ, fiat and any later supported cash/crypto asset separately.
- Show BGC only as separate game credit and never include it in cash/crypto
  profit.
- Keep non-operating movements visible but outside operating activity.
- Preserve unavailable realised trading results when same-asset cost basis is
  missing.
- Display the requested period, data-current-through and last-imported
  timestamps separately.
- Show source, classification and reconciliation warnings without converting
  missing evidence to zero.
- Never expose a combined-asset total or complete lifetime-profit claim.

## Interface

The route is a dynamic Server Component with no client-side persistence code.
The empty state says that no accepted report is available. A connected report
is labelled as historical recorded activity rather than a live wallet balance.

## Deferred work

- provider-specific owner-scoped materialized-summary SQL;
- private ledger and manual-entry forms;
- representative private reconciliation evidence;
- conversion views with dated rates; and
- Preview or Production configuration.
