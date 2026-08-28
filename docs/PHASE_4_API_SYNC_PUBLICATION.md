# Phase 4 API Sync Publication Foundation

## Scope

This slice establishes the first persistent API-only boundary without writing real DNA Open Lab data.

Migration `0069_dna_open_lab_sync_publication` adds owner-scoped storage for:

- immutable DNA Open Lab sync generations;
- the six required current-state family receipts;
- the accepted and serving last-good generation pointers;
- pause/interruption metadata; and
- catch-up-required and last-catch-up state.

The six publication families are Vault, Cores, active races, race fills, Tokens and Splice Arena. A generation can become serving state only when every family is complete.

## Safety properties

- Forced RLS protects every table.
- The runtime role has no direct table access and uses narrow security-definer functions.
- Owner scope is verified before every repository operation.
- Stage and publish execute in one serializable application transaction.
- Partial candidates cannot replace the last-good generation.
- Older observations and regressing operation timestamps fail closed.
- A rate/API/tier interruption preserves the accepted serving pointer.
- Published-generation replay is idempotent and cannot clear a later pause.
- Database responses are validated before becoming application state.

## Evidence boundary

Tests use deterministic synthetic generation IDs, counts and timestamps. This slice performs no connected API call, Neon account mutation, R2 write, hosted migration or persistent real backfill.

Persistent real Preview synchronization remains blocked by P5 capacity/recovery evidence and explicit owner approval.

## Deferred P4 work

- persistent finished-race backfill checkpoints and R2 receipt binding are
  delivered by migration `0070`; see
  `PHASE_4_FINISHED_RACE_BACKFILL_PERSISTENCE.md`;
- current owned-Core identity/ownership materialization is delivered by
  migration `0071`; see `PHASE_4_OWNED_CORE_READ_MODEL.md`;
- active-race/fill persistence is delivered by migration `0072`;
- supplemental Core persistence is delivered by migration `0073`;
- Token/Splice canonical materialization is delivered by
  `PHASE_4_TOKEN_SPLICE_CURRENT_STATE.md`; compact persistence is delivered by
  migration `0074`;
- the Neon publication repository now validates and stages every current-state
  family through the complete `0074` contract in one transaction, while
  explicitly rejecting runtime access to retired partial-stage functions;
- acquisition-worker scheduling and endpoint-appropriate family cadences; and
- storage/capacity/recovery measurement for the P5 gate.

The deterministic local cadence/recovery policy is now delivered by
`PHASE_4_CURRENT_STATE_ACQUISITION_CADENCE.md`. Hosted dispatch and durable cycle
checkpoint wiring remain deferred.
