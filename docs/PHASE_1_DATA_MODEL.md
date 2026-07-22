# Phase 1 Data Foundation Schema

Date: 22 July 2026  
Status: verified for Phase 1  
Deployment scope: repository and ephemeral CI PostgreSQL only

## Purpose

Migration `0001_data_foundation` creates the durable PostgreSQL structures required before source adapters or private hosted imports are enabled. It is additive, reversible on an empty test database and does not connect to Neon or any Production environment.

## Ownership and privacy

Every private table is owner-scoped and protected by fail-closed PostgreSQL row-level security using the transaction-local `app.owner_id` setting. Public schema, table and function privileges are revoked. The migration creates no application role, credential, provider integration or data.

Raw uploads remain in private object storage. PostgreSQL retains only the private provenance needed for audit, rollback, conflict review and normalized application state. Filenames, raw source strings and external references are private fields and must never be emitted in routine logs.

## Import and freshness

The schema separates:

- batch minimum and maximum accepted event timestamps;
- active-dataset `Data current through`;
- upload and import-completion times;
- aggregate-refresh completion;
- accepted, rejected and warning counts;
- source encoding, checksum and schema version; and
- active dataset versions and rollback state.

A unique owner, source-type and checksum constraint prevents a repeated file from becoming a second accepted batch. Race facts retain stable source IDs, while each contributing batch retains row-level provenance without making raw rows public.

## Gold and Blue

Race events and entries derive `gold_star_eligible` from `gate_count > 3` as a generated column. Gold and Blue remain nullable normalized facts. Raw values stay in race-entry provenance.

The schema deliberately permits a source Gold assignment at three gates or fewer so it can be retained. Event validation stores the resulting anomaly code rather than rejecting or rewriting the source fact. Assignment counts and validation warnings are separate from later predictive aggregates.

## Open Race observations

Manual post-lock star observations use dedicated tables. They cannot become authoritative race entries merely because a candidate composite key matches. Reconciliation records link an observation to a later imported event, preserve exact-match or mismatch status and prevent the manual observation from silently duplicating analytical evidence.

## Core, vault, lineage and arena snapshots

Source core IDs are authoritative. Ambiguous or unmatched identity proposals remain in a review table. Current Vault and Arena imports are stored as timestamped snapshots with at most one current snapshot per owner. Arena listings record imported availability and fees only; they create no breeding-income transaction.

The lineage edge model records two known parent roles or an explicit unknown role while preventing a core from being its own parent.

## Economic integrity

Transactions store signed exact atomic amounts as `numeric(78, 0)` and reference one explicit asset/currency. BGC is a distinct asset kind and cannot share the BGC code with another asset kind. Deposits, withdrawals, internal transfers, opening balances and reconciliation adjustments are structurally prohibited from affecting operating P/L.

Race-entry economics remain `unvalidated` until source fee and payout semantics are confirmed. Raw fee and payout strings stay in provenance and therefore cannot create dependable totals by themselves.

## Migration verification

CI starts an ephemeral PostgreSQL 16 service, applies the up migration, runs a synthetic transactional smoke test, applies the down migration and verifies the schema was removed. The smoke test confirms:

- three-gate Gold ineligibility is generated correctly;
- an anomalous source Gold assignment is retained with a warning;
- manual observations remain separate and pending;
- BGC remains a separate asset; and
- an internal transfer cannot enter operating cashflow.

No synthetic row is committed because the smoke test rolls back.
