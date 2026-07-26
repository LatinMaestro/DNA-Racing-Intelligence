# Phase 2A Vault Performance Economic Forms

## Status

The authenticated Vault Performance route renders this accessible form shell,
but every field and submit control remains disabled while owner-scoped write
persistence is unavailable. It does not record economic evidence, call a
wallet or game system, request signing material or change Production.

## Contract

- Present separate semantic forms for manual ledger evidence and completed
  tournament payouts.
- Label every control and expose the current write-capability state as status
  text rather than relying on colour.
- Keep original asset codes and exact decimal entry visible. BGC remains a
  separate game-credit asset and never becomes cash or crypto profit.
- Explain that deposits, withdrawals and transfers are non-operating.
- Explain that tournament payouts remain reviewable against later imported
  evidence before aggregate inclusion.
- Never request wallet credentials, private keys, seed phrases or signing
  material.
- Keep all fields and submit buttons disabled until the authenticated
  owner-scoped write repository is deliberately connected and validated.

## Remaining evidence

- Add strict `FormData` parsing, server-generated durable IDs and action-state
  feedback only when the forced-RLS write repository is connected.
- Add conditional allocation controls for single-core, equal, manual-amount,
  percentage and documented-points payout methods.
- Exercise submission, replay, conflict, reversal and reconciliation states
  against persistent Preview storage before Gate D.
