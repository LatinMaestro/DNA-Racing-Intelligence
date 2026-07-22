# Phase 1 Current Snapshot Materialization

## Scope

This slice transactionally materializes the latest imported Current Vault and Current Arena files as historical snapshots. It does not claim live game state. Each snapshot retains separate source-current-through, import and activation timestamps through the dataset-version ledger.

## Current Vault

The Current Vault export has no authoritative core ID. Every ready source row is therefore retained as a row-scoped snapshot entry with its normalized descriptive fields, original name, exact Maiden value and a private identity-review record.

A composite match against selected Core Details may produce one proposed core candidate, but it is never auto-confirmed. Multiple candidates remain ambiguous and no candidates remain unmatched. Snapshot row keys are provenance and deduplication keys only; they do not become core identities.

Maiden values remain distinct:

- valid true becomes `eligible`;
- valid false becomes `not_eligible`;
- missing becomes `unknown`; and
- invalid remains `invalid`.

## Current Arena

Arena source core IDs are authoritative and may link only to an exact selected Core Details ID. Missing IDs create an unmatched identity-review record and remain unlinked.

The exact USD listing text is stored without rounding, conversion or atomic-unit inference. A listing is availability and price evidence only. Materialization is constrained to create no economic transaction, income, expense or operating P/L entry.

## Snapshot activation and rollback

Each accepted file creates an immutable snapshot tied to its import batch. A newer accepted snapshot becomes current while all earlier snapshots remain queryable. Exact replay is idempotent. A reasoned dataset rollback restores the prior snapshot as current without deleting history.

The current views select only the snapshot whose dataset version is active. Stale or unknown source-current-through values remain visible through the existing freshness contract; they are not relabelled as live.

## Privacy and verification

Typed staging and snapshot-entry tables use forced owner row-level security, and all tables, views and functions are revoked from `PUBLIC`. Synthetic PostgreSQL 16 checks cover typed coverage, candidate-only Vault identity, Maiden-state preservation, exact Arena ID linking, unmatched identity review, exact source price text, snapshot replacement, rollback restoration, replay safety, privilege revocation and complete reverse migration.

No private export, real core name, economic record, provider account, secret, hosted database or Production setting is changed by this repository-only migration.
