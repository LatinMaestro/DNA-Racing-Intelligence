# Phase 6 Breeding Economic Forms

## Status

The authenticated Breeding route renders this accessible evidence shell, but
every field and submit control remains disabled while owner-scoped write
persistence and strict form parsing are unavailable.

## Contract

- Present separate semantic forms for completed/refunded breeding evidence and
  optional offspring cost-basis review.
- State explicitly that Arena listings are availability evidence and cannot
  create income or expense.
- Preserve original-asset entry and BGC separation; never infer market value or
  realised gain.
- Require confirmed actual pairing costs and confirmed owned offspring before a
  future assignment can pass review.
- Label every control and expose the capability state in text.
- Never request wallet credentials, private keys, seed phrases or signing
  material and never initiate a splice, wallet or game transaction.
- Keep every fieldset and submit button disabled until the owner-scoped
  forced-RLS write repository is connected and validated.

## Remaining evidence

- Add strict `FormData` parsing, server-generated durable IDs, multi-component
  transaction controls and action-state feedback.
- Exercise completion, refund, replay, conflict, held evidence and duplicate
  cost-basis paths against persistent Preview storage before enabling writes.
