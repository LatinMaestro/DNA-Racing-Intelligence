# Phase 7 Lifecycle Economic Actions

## Status

This Server Action boundary is staged and disabled. It does not connect
persistence, sell or burn a core, predict burn credit, mutate ownership, call a
wallet or game system, request signing material or change Production.

## Contract

- Resolve Clerk identity inside every action invocation and compare it with the
  configured single-owner allowlist before persistence access.
- Never accept an owner identifier from the browser.
- Delegate confirmed sale evidence, completed burn evidence and actual BGC
  credit evidence only to the existing validated lifecycle write service.
- Preserve exact original assets, missing-cost-basis states, append-only
  evidence, historical lineage and canonical replay/conflict rules.
- Preserve the permanent Genesis burn prohibition.
- Keep strategic recommendations separate from execution evidence and never
  infer an actual BGC amount.
- Do not request or accept wallet credentials, private keys, seed phrases or
  signing material.
- Return `persistence_not_configured` until an owner-scoped forced-RLS
  repository is deliberately connected and validated.

## Remaining evidence

- Add strict `FormData` parsing, server-generated durable IDs and accessible
  disabled sale, burn and actual-credit forms.
- Connect persistence only after forced owner RLS and operation-level
  idempotency are proven.
- Exercise record, replay, conflict, Genesis rejection, multiple-credit review
  and missing-cost-basis paths against persistent Preview storage.
