# Phase 7 Lifecycle Economic FormData

## Scope

This boundary parses completed sale, completed burn and actual post-burn BGC
credit evidence without enabling the visible forms, changing ownership or
connecting persistence.

## Completed sale

- Generate the sale ID and recorded timestamp server-side.
- Require accepted active ownership from server configuration.
- Preserve exact proceeds, selling fees and optional acquisition cost in the
  configured original asset.
- Keep missing acquisition cost explicit rather than fabricating realised gain.
- Reject browser ownership, evidence-status, recommendation or durable-ID
  fields.

## Completed burn

- Generate the burn ID and recorded timestamp server-side.
- Resolve accepted active ownership and core class from server configuration.
- Require the submitted class to agree with accepted evidence and permanently
  reject Genesis.
- Require an explicit-offset completion time and meaningful reason.
- Predict no burn credit and perform no ownership mutation.

## Actual BGC credit

- Resolve one confirmed durable burn and its core from server configuration.
- Generate the credit ID server-side and fix the asset to BGC.
- Require a positive exact actual amount and a credit time not before the burn.
- Delegate matching to the authoritative burn-credit reconciliation domain.
- Keep historical Race Merge BGC rows outside this form; they remain
  zero-economics race-performance evidence.

## Deferred activation

Every form remains disabled pending accessible action feedback, forced-RLS
Preview persistence and exact-head CI. No sale, burn, wallet, game, ownership,
provider or Production operation is possible through this parser.
