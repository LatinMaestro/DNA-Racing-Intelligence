# Phase 4 Tournament Prize Reconciliation

This contract protects campaign economics from double counting between manually
recorded external tournament prizes and imported race payouts.

## Guarantees

- Exact external-reference matches and same-asset/date/amount/tournament matches are
  review candidates only.
- Shared references with incompatible asset or amount evidence surface a conflict.
- No candidate is excluded automatically.
- A reasoned `confirmed_duplicate` decision excludes only the manual payout and
  preserves the imported fact.
- A reasoned `confirmed_separate` decision preserves both payments.
- A duplicate cannot be confirmed against an undetected or already excluded imported
  target.
- Assets and amounts remain exact and separate.
- Vault-level overall prizes never require artificial core allocation.

## Deferred composition

Durable reconciliation records, user review screens and campaign-report integration
remain separate focused work. This contract supplies deterministic candidate and
decision behaviour without changing imported source facts.
