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

Every transition is bound to the exact session, field, eligibility, ranking,
lock, observation and comparison version as applicable. The read envelope also
binds the latest accepted Race Merge import, Vault snapshot and published
historical aggregate versions. Candidate mode, distance in metres, historical
cutoff, confirmed eligibility and opponent identities must remain coherent
across the session.

## Safety properties

- The authenticated Clerk owner must match the server-side allowlist before any
  repository read.
- The route remains an async Server Component and receives only compact
  validated projections.
- Freshness is derived at the server boundary from canonical accepted cutoffs;
  stored labels cannot override the exact 3-day current, 4-to-7-day ageing and
  8-day stale boundaries.
- Future, non-canonical and post-import evidence is rejected. The field and
  ranking must use the latest accepted Race Merge version, while eligibility
  must use the latest accepted Vault snapshot.
- Current-race Gold and Blue cannot enter Stage A eligibility or ranking.
- Hidden current-race star fields are rejected at the field, opponent,
  candidate and ranking boundaries.
- Historical star evidence may be disclosed but cannot alter the time rank.
- Material ties are scoped to the leading time rather than chained between
  adjacent candidates.
- Stage B is available only after the field is full, the race is set to run and
  the owner confirms the committed core.
- Post-lock observations are diagnostic only. They cannot recommend switching,
  mutate the frozen ranking, prove a prediction, or represent a completed race
  result.
- Gold is not applicable when the locked race has three gates or fewer; a
  contrary manual observation remains a review anomaly.
- The lock contains the exact captured opponent set, committed eligible core,
  field-capture time and ordered frozen-ranking evidence. The comparison must
  match that ranking order, entered field, signals, timestamps and observation
  status exactly.
- Manual observations remain pending until idempotent reconciliation with an
  authoritative Race Merge import.
- Missing evidence remains unavailable rather than being interpreted as zero or
  negative evidence.
- Gate C, race entry, mutations, provider initialization, Preview and Production
  remain disabled.

## Validation contract

The exact integration head must pass:

- Prettier formatting;
- ESLint;
- strict TypeScript;
- synthetic domain and service coverage for identity, fail-closed persistence,
  complete staged composition, all five stages, exact version/import bindings,
  3/4/7/8-day freshness, chronological rejection, frozen ranking/field/signal
  drift and duplicate requests;
- static React rendering of disconnected and fully compared states, including
  semantic disabled controls and explicit non-actionable copy;
- the cumulative optimized build, production dependency audit, privacy scan and
  PostgreSQL migration apply/smoke/reverse/removal checks.

Source identity: queue order 20, `agent/open-race-read-workspace` at
`6254a9a2a409486c4825653a022971f825b7e62f`, recomposed onto verified `main` at
`cfc66c62b131c78c3cb2a51273c98f6473ca942f`. Hosted results are recorded only
against the final pull-request head.
