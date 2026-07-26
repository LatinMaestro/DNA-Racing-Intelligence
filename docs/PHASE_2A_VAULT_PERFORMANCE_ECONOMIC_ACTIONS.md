# Phase 2A Vault Performance Economic Actions

## Status

This Server Action boundary is staged and disabled. It does not connect
persistence, submit a wallet transaction, call the game, change ownership,
record private economic evidence or change Production.

## Contract

- Resolve Clerk identity inside every action invocation and compare it with the
  configured single-owner allowlist before persistence access.
- Never accept an owner identifier from the browser.
- Delegate manual ledger entry, append-only reversal, tournament payout and
  payout-reconciliation decisions to the existing validated write services.
- Keep exact assets separate and preserve the services' durable fingerprint,
  replay, conflict, allocation and reconciliation rules.
- Keep deposits, withdrawals and transfers outside operating P/L.
- Keep actual BGC movement separate from cash and crypto reporting.
- Do not request or accept wallet credentials, private keys, seed phrases or
  signing material.
- Return `persistence_not_configured` until an owner-scoped repository is
  deliberately connected and validated.

## Remaining evidence

- Connect the repository through forced owner RLS and operation-level
  idempotency after migration execution is available.
- Add accessible authenticated forms whose submitted values map only to these
  typed action inputs.
- Exercise record, replay, conflict, reversal, duplicate-review and final
  reconciliation paths against persistent Preview storage before Gate D.
