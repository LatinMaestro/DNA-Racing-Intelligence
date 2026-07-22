# Phase 1 Manual Star-Observation Reconciliation

Date: 23 July 2026  
Status: repository migration and ephemeral PostgreSQL verification  
Production: disabled and fail-closed

## Scope

Migration `0005_star_observation_reconciliation` reconciles optional post-lock
manual Gold/Blue observations against later active Race Merge history. It uses
synthetic fixtures and remains repository-only. It does not create race facts,
change imported star assignments, refresh profiles or treat observations as
pre-entry information.

## Authority and matching

An observation with an authoritative game event ID may be resolved
automatically after that event exists in the active imported dataset. The
executor checks:

- exact event time, mode, distance and gate count;
- the complete sorted entered-core set;
- Gold eligibility;
- event-level imported star-data completeness and ambiguity; and
- observed versus imported Gold and Blue assignments.

Without an authoritative event ID, date/time, mode, distance, gate count and
entered-core set form only a cautious candidate search. Even one exact
composite candidate remains `review_required`; it is never promoted to an
authoritative match automatically. Zero and multiple candidates remain
unlinked with separate stable detail codes.

## Outcomes

- `exact_match` marks an authoritative observation reconciled.
- `mismatch` surfaces metadata, field, Gold-eligibility or star-assignment
  disagreement without changing the imported fact.
- `review_required` covers candidate-only suggestions, not-yet-imported
  authoritative IDs, incomplete validation and ambiguous imported assignments.
- `excluded` covers malformed observations whose stars or field cannot be
  trusted.

The imported Race Merge record remains authoritative unless the owner later
records a supported correction through a separate auditable workflow.

## No duplicate evidence

Reconciliation records use deterministic owner/observation/event identities
and unique database keys. Automatic replay replaces its unreviewed suggestion
rather than creating another record. Manually reviewed reconciliation rows are
not overwritten.

Neither exact nor candidate reconciliation writes to `race_entry`,
`event_star_validation` or `core_star_profile`. Profiles continue to derive
only from deduplicated active imported history, so a manual observation cannot
create a second star count.

## Open Race boundary

These records describe the locked, about-to-run stage after the user's entry
decision is committed. They are not completed results, prediction successes or
inputs to a replacement-core recommendation. Gold remains unavailable at three
gates or fewer, and a recorded ineligible Gold is surfaced as a mismatch.

## Privacy and verification

All existing observation and reconciliation tables retain forced owner RLS.
The executor is owner-scoped, serialized and not executable by `PUBLIC`.

PostgreSQL 16 CI verifies:

- authoritative exact matching;
- imported/manual star mismatch surfacing;
- candidate-only review without automatic acceptance;
- not-yet-imported authoritative IDs remaining unlinked;
- ineligible manual Gold handling;
- idempotent replay without profile changes;
- revoked public execution; and
- complete migration reversal before earlier migrations are removed.
