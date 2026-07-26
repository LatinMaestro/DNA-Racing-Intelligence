# Phase 9 Hosted Accounting Attestations

## Boundary

This evidence-only contract binds economic-ledger and reconciliation controls to
one exact candidate head, one reviewed accounting manifest and one
synthetic-fixture manifest. It does not connect persistence, mutate records or
claim complete lifetime profit.

Required controls cover exact asset-separated balances, BGC as non-cash credit,
historical Race Merge BGC as zero economics, transfer exclusion, manual
tournament reconciliation, completed/refunded breeding evidence, lifecycle sale
cost basis, actual post-burn BGC, freshness/provenance and idempotent rebuilds.

## Evidence rules

- Use fixed reviewed command identities and exact decimal arithmetic.
- Record exact UTC bounds, complete assertions and a redacted summary digest.
- Keep ETH, DEZ, fiat and BGC separate without implicit conversion.
- Require historical BGC races to create no ledger transaction.
- Exclude deposits, withdrawals and transfers from operating profit/loss.
- Preserve nullable cost basis and incomplete-coverage warnings.
- Require durable replay, source provenance and accepted-version freshness.
- Use synthetic fixtures only and retain no private artifact.
- Require connected evidence for persistence-backed controls.
- Block stale heads, manifest drift, partial checks and unsafe accounting.

## Authority

The projection cannot dispatch Actions, merge, connect providers, mutate
economic records or change Production. Connected persistence and private
chronological reconciliation remain unclaimed until protected Preview evidence
exists.
