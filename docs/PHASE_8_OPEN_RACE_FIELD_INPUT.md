# Phase 8 Open Race Field Input

## Purpose

Create an auditable Stage A input boundary for the manually visible race field
before the user commits a core.

## Contract

- Accept mode, exact distance in metres, gate count, available gates, race
  format, optional exact entry fee, visible restrictions and entered opponent
  IDs.
- Require entered opponents plus available gates to reconstruct the configured
  field without exceeding gate capacity.
- Keep unresolved opponent identities, uncertain restrictions and stale
  historical evidence review-required.
- Preserve `Data current through`, `Last imported` and capture time separately.
- State that current field facts are manual and historical profiles are periodic
  imported snapshots.
- Structurally expose the stage as `forming` and reject current-race stars from
  the input model.

## Boundaries

The contract does not fetch game state, accept current-race Gold or Blue stars,
select a core, enter a race, reserve a gate or imply that imported evidence is
live.
