# Phase 4 Current-Race API Read Model

## Scope

Migration `0072_dna_open_lab_current_race_read_model` persists the compact
canonical `races.active` and `races.fills` observations proven in P3 and bound
by the generation materialization contract delivered in PR #341.

Each row stores only the stable source race ID, observation time, evidence
SHA-256 and canonical adapter output. Raw DNA responses remain outside Neon in
the private evidence boundary. The schema does not invent distance, outcome,
elapsed time or finish position.

## Atomic publication and last-good serving

The runtime can stage a candidate only through the current-race wrapper. It
requires exact complete-family counts, unique IDs, chronology, valid fill gate
coverage and a same-generation active-race parent for every fill. A publication
trigger independently checks Core, active-race and fill receipt counts before
the last-good pointer can advance.

Serving functions join only the accepted serving generation. A rate limit, API
failure or tier interruption therefore leaves the previous current-race view
available until a later complete candidate is accepted.

## Isolation and point-in-time rules

- Both tables use forced owner RLS.
- The runtime role has no direct table access.
- Core-only and count-only staging functions are unavailable to the runtime.
- Narrow security-definer functions stage and read owner-scoped rows.
- Fill state is a timestamped current observation, never a historical outcome or
  a feature that may leak into an earlier recommendation.
- Pro League opportunity matching is Bike-only under the 28 August 2026 owner
  clarification; Car and Horse active races remain valid for other workflows.

## Approval boundary

All fixtures and database evidence are synthetic. This migration is not applied
to hosted Neon, does not call DNA Open Lab, stores no owner payload, deploys no
website and does not open the P5 first-real-sync gate.
