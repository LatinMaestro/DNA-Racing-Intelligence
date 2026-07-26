# Phase 2A Vault Performance FormData Boundary

## Status

The repository contains a strict, provider-neutral parser for the staged manual
ledger and tournament-payout forms. It creates durable evidence IDs through an
injected server-only factory and derives asset kind and precision from reviewed
server configuration. It is not connected to a form action or persistent
repository, so it cannot record private evidence.

## Contract

- Reject unknown fields, repeated scalar fields, non-text values, unbounded
  values and browser-supplied durable IDs.
- Require timestamps with an explicit UTC offset and canonicalize them to UTC.
- Normalize positive exact base-10 decimals without binary floating point.
- Resolve asset kind and precision from server configuration. Require BGC to be
  the separate game-credit asset and keep BGC outside tournament payouts.
- Require a server-configured manual category/subcategory pair and unique
  bounded core IDs.
- Keep transfer and directional-adjustment submission disabled until the ledger
  domain produces balanced exact postings for those categories.
- Keep per-core tournament allocation methods disabled until conditional,
  accessible allocation controls and strict repeated-row parsing exist.
- Re-run the existing manual-ledger or tournament-payout domain validator before
  returning a typed input.

## Remaining evidence

- Connect the parser only through an authenticated Server Action that creates
  the durable ID and returns accessible action-state feedback.
- Add balanced transfer and directional-adjustment domain postings before those
  categories can be enabled.
- Add conditional payout allocation controls and exact repeated-row parsing.
- Exercise create, replay, conflict, reversal and reconciliation against
  owner-scoped forced-RLS Preview persistence before enabling either form.
