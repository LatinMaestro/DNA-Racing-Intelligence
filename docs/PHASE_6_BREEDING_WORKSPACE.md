# Phase 6 Breeding Read Workspace

## Purpose

Expose owner-scoped pair-ranking evidence while keeping elite-upside,
Vault-gap and balanced objectives separate. This is a historical review
interface, not a pairing or transaction executor.

## Application boundary

- Verify the authenticated Clerk owner against the server-only allowlist before
  persistence.
- Return explicit identity-disconnected and persistence-not-configured states.
- Load compact ranking inputs and build deterministic results through the Phase
  6 pair-ranking contract.
- Reject duplicate ranking IDs, duplicate parent pairs, invalid exact distances,
  inconsistent timestamps and unsupported evidence states.
- Keep providers lazy and server-only.

## Evidence boundary

- Never use Vault fit to suppress the elite-upside ranking.
- Keep Vault-gap improvement independent from elite upside.
- Use only explicit integer basis-point weights in the balanced ranking.
- Preserve mode, exact distance in metres, parent identity and confidence.
- Hold stale, unavailable, rule-unresolved or uncalibrated evidence.
- Require supported incremental holdout lift before star features can enter a
  ranking.
- Treat Arena availability as a historical snapshot with freshness, never live
  state.

All rankings remain experimental. Gate E is not passed, and no pairing or
breeding transaction is authorised.

## Deferred work

- provider-specific owner-scoped ranking queries;
- current Arena availability verification;
- calibrated offspring-distribution evidence;
- fee and economic review;
- owner-confirmed execution controls; and
- Preview or Production configuration.
