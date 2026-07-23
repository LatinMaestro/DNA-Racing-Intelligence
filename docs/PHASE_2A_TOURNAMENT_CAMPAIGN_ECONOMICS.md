# Phase 2A Tournament Campaign Economics

## Scope

This contract aggregates recognised tournament economic records for one
configured campaign and period. It is deterministic, source-agnostic and uses
only immutable ledger evidence supplied by the persistence layer.

It does not classify races, manufacture a tournament link, infer a completed
manual payout, allocate a vault-level prize to a core, convert currencies or
claim complete lifetime profit.

## Accepted records

Campaign aggregation supports:

- qualification entry fees;
- qualification race payouts;
- automated round payouts;
- automated final payouts;
- manual tournament payouts; and
- recorded campaign expenses.

Each record must be operating activity, have a recognised category and
direction, preserve one original asset, retain inclusion/exclusion state and
carry classification, reconciliation and allocation evidence.

Only records linked to the selected tournament and inside the inclusive
campaign period enter the report. Excluded records remain counted but do not
affect totals.

## Accounting controls

- Exact base-10 arithmetic is used throughout.
- Cash, crypto and BGC are never combined.
- BGC remains a separate game-credit report.
- Category direction is enforced: fees and expenses are debits; payouts are
  credits.
- Duplicate transaction IDs fail closed.
- A vault-level payout remains unallocated and is never split across cores.
- An explicit core link requires at least one unique authoritative core ID.
- Inferred and unclassified activity remains visible.
- Unresolved reconciliation leaves the campaign report partial.

`complete_recorded_period` describes only the stated recorded source period. It
is not a complete-lifetime-profit claim.

## Warnings

The result exposes:

- incomplete source coverage;
- unknown manual external-payout coverage;
- inferred or unclassified campaign activity;
- unresolved reconciliation;
- vault-level unallocated payouts; and
- an unknown imported-data cutoff.

Unallocated vault-level prizes do not make the campaign total arithmetically
incomplete, but they prevent fabricated per-core attribution.

## Deferred work

Persistence, campaign configuration, bracket/stage correction UI, explicit
manual payout split methods, core economic profiles and the dashboard remain
separate Phase 2A/Phase 4 slices. Exact-head GitHub CI remains mandatory before
merge, and Production remains disabled.
