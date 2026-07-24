# Phase 5 Maiden Entitlement Lifecycle

## Scope

This contract projects an imported Maiden-eligibility snapshot through explicit,
reasoned manual lifecycle events. It keeps `eligible`, `planned`, `committed` and
`consumed` distinct and retains the complete revision history.

## Controls

- Imported `unknown`, `invalid` and `not_eligible` evidence cannot be planned.
- Planning requires a tournament; commitment, release and consumption must
  target that same tournament.
- Events require unique IDs, sequential revisions, reasons and chronological
  timestamps, and cannot predate the imported snapshot cutoff.
- A consumed entitlement is not silently restored. A future correction workflow
  must preserve separate audit evidence rather than rewriting this history.
- `Data current through`, `Last imported` and freshness remain separately
  visible.
- The lifecycle records state only. It cannot recommend or execute an entry and
  remains behind Gate D.

## Deferred composition

Persistence, owner-authenticated editing, UI controls and integration with
tournament recommendations remain separate focused slices after the staged
contracts receive exact-head CI.
