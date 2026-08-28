# Phase 4 Owned-Core API Read Model

## Scope

Migration `0071_dna_open_lab_owned_core_read_model` adds the first compact
current-state read model justified by connected P3 evidence. It stores the
API-authoritative `vault.cores_full` identity and ownership snapshot for each
immutable sync generation:

- numeric Core ID;
- display name;
- Core class;
- element;
- F-number;
- sex;
- optional source color;
- observation time; and
- raw-evidence SHA-256 reference.

The raw API response is not stored in Neon. Future connected synchronization
may retain full evidence in the existing private R2 boundary.

## Publication and last-good safety

The runtime stages new candidates through one materialized wrapper. The wrapper
validates exact field/type bounds, uniqueness, chronology, evidence checksums and
that the owned-Core row count equals the complete `cores` family receipt.

A database trigger prevents a generation using this materialization contract
from publishing unless that exact Core coverage exists. The website read
function joins only the accepted serving generation, so API unavailability,
rate limiting or tier loss continues to serve the previous last-good Core
snapshot.

## Isolation and point-in-time boundary

- The snapshot table uses forced owner RLS.
- The runtime role has no direct table access.
- The older count-only stage function is revoked from the runtime role.
- Narrow security-definer functions stage and read owner-scoped rows.
- Current ownership/identity is timestamped API state; it does not overwrite
  local roster, substitution, Maiden, Discovery, notes or accounting history.

## Evidence and approval boundary

Tests and migration checks use deterministic synthetic Cores only. This slice
does not call DNA Open Lab, apply a hosted migration, write R2/Neon owner data,
deploy Vercel/Cloudflare or perform a persistent real backfill.

P5 capacity/recovery evidence and explicit owner approval remain required before
the first persistent real Preview synchronization.

## Deferred P4 work

- generation-bound active-race/fill persistence is implemented by migration
  `0072`;
- supplemental Core observations, including power, racing stats, stamina,
  assets, listing and splicing state;
- Token and Splice Arena read models;
- generation workers and endpoint-appropriate cadences; and
- P5 storage/capacity/recovery measurement.
