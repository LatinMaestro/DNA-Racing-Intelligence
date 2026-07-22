# Phase 1 Star Validation and Profile Materialization

Date: 23 July 2026  
Status: repository migration and ephemeral PostgreSQL verification  
Production: disabled and fail-closed

## Scope

Migration `0004_star_profile_materialization` turns active normalized Race Merge
facts into durable event-level validation and count-based core star profiles. It
uses synthetic fixtures and remains repository-only. It does not connect to
Neon, consume private uploads, calculate field strength or make a predictive
quality claim.

## Event validation

The refresh validates every active historical event as one unit.

- Gold eligibility remains database-derived from `gate_count > 3`.
- Zero, one and multiple Gold or Blue assignments remain distinct.
- Multiple assignments preserve every assigned source core ID in sorted order
  while the unique assigned-core field remains null.
- Gold and Blue completeness are calculated independently. Missing or invalid
  Gold does not erase otherwise complete Blue evidence, or vice versa.
- Source Gold in a one-, two- or three-gate event is preserved and flagged but
  cannot create a Gold assignment opportunity.
- Incomplete, invalid and ambiguous events remain visible with stable warning
  codes and are excluded only from the affected denominator.

Manual post-lock observations are not queried. They remain separate from
authoritative Race Merge facts until the later reconciliation slice.

## Core profiles

Profiles are grouped by authoritative source core ID, mode and exact distance.
They store counts rather than unexplained percentages:

- total and complete/partial/missing/invalid races;
- Gold-eligible races;
- Gold and Blue assignment opportunities;
- received and negative-opportunity counts;
- complete eligible events with no Gold assignment;
- complete events with no Blue assignment;
- ineligible source Gold assignments;
- signal-specific excluded anomaly counts; and
- same-core Gold-and-Blue occurrences.

The received rate is always presented as its received numerator over assignment
opportunity denominator. A zero-assignment event is not silently converted into
negative evidence. `data_current_through` is the latest included historical
event timestamp, not a statement of live game state.

## Atomic refresh and freshness

`dna.refresh_star_profiles` accepts only the active owner-scoped Race Merge
dataset version. It serializes refreshes, atomically replaces that owner's
derived validation/profile cache, and marks the queued aggregate job plus the
dataset's `aggregate_refreshed_at` only after both replacements succeed.

An unhandled failure rolls back the cache replacement and completion markers
together. Repeating the refresh produces the same event and profile rows. The
reversible down migration clears only rebuildable derived validation/profile
state; normalized race facts and source provenance are not deleted.

## Privacy and verification

The profile table uses forced owner row-level security and has no `PUBLIC`
access. The refresh function also revokes `PUBLIC` execution. Routine outputs
are aggregate counts and timestamps; no private source rows are logged.

PostgreSQL 16 CI verifies:

- unique, zero and ambiguous assignments without false winner selection;
- strict three/four-gate Gold eligibility;
- independent Gold and Blue completeness;
- explicit profile numerators, denominators and coverage;
- deterministic replay and aggregate completion timestamps;
- owner isolation and revoked function privileges; and
- full migration reversal before earlier migrations are removed.
