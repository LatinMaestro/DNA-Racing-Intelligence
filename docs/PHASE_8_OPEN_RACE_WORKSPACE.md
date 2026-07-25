# Phase 8 Open Race workspace

## Scope

This slice replaces the Open Race placeholder with an authenticated,
owner-scoped, provider-neutral read workspace. It composes the existing field
input, eligibility, pre-entry ranking, field-lock, star-observation and
star-comparison contracts without enabling a mutation, race entry or live game
connection.

## Staged model

The compact repository may expose one of five durable states:

1. `field_forming` — the current field was manually captured but no accepted
   ranking exists;
2. `provisional_selection` — eligible owned cores were ranked from imported
   historical evidence while the field was forming;
3. `locked_observation` — the owner committed an entered core and the complete
   field was frozen;
4. `observation_recorded` — optional Gold/Blue observations were recorded after
   lock as non-authoritative evidence;
5. `observation_compared` — the observation was compared with the frozen
   pre-entry ranking without changing it.

Every transition is bound to the exact request, ranking, lock and observation
identifiers. Candidate mode, distance in metres, historical cutoff, confirmed
eligibility and opponent identities must remain coherent across the session.

## Safety properties

- The authenticated Clerk owner must match the server-side allowlist before any
  repository read.
- The route remains an async Server Component and receives only compact
  validated projections.
- Current-race Gold and Blue cannot enter Stage A eligibility or ranking.
- Historical star evidence may be disclosed but cannot alter the time rank.
- Stage B is available only after the field is full, the race is set to run and
  the owner confirms the committed core.
- Post-lock observations are diagnostic only. They cannot recommend switching,
  mutate the frozen ranking, prove a prediction, or represent a completed race
  result.
- Gold is not applicable when the locked race has three gates or fewer; a
  contrary manual observation remains a review anomaly.
- Manual observations remain pending until idempotent reconciliation with an
  authoritative Race Merge import.
- Missing evidence remains unavailable rather than being interpreted as zero or
  negative evidence.
- Gate C, race entry, mutations, provider initialization, Preview and Production
  remain disabled.

## Hosted validation

The focused workspace slice passes:

- Prettier formatting;
- ESLint;
- strict TypeScript;
- six synthetic service tests covering identity, fail-closed persistence,
  complete staged composition, forming/provisional states, cross-session
  rejection and duplicate request rejection;
- a React review confirming server-only data loading, semantic disabled
  controls, stable keys and no browser persistence path.

The cumulative repository build and full test suite remain represented by the
last exact Lifecycle rehearsal until this focused branch is composed into the
next offline integration head.
