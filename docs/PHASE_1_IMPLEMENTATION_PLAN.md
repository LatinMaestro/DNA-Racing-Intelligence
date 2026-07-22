# Phase 1 Implementation Plan

Date: 22 July 2026  
Status: in progress  
Production: disabled and fail-closed

## Boundary

Phase 1 establishes the private, idempotent and auditable data foundation. It does not present analytical recommendations or dependable financial totals. Repository tests use synthetic fixtures only. Full private-data hosting remains blocked until Gate B evidence is complete and the required client account actions are available.

## Focused delivery slices

1. **Import contracts and deterministic keys — complete**
   - typed source and batch states;
   - checksum, timestamp and row-count invariants;
   - legacy Core Details `bikeid` alias handling;
   - stable race-entry and race-economic keys;
   - authoritative versus candidate-only manual star-observation matching.

2. **PostgreSQL schema and reversible migration — complete**
   - owner, asset, core, lineage and source-provenance records;
   - import manifests, warnings and accepted dataset versions;
   - nullable Gold/Blue facts, explicit Gold eligibility and star-data status;
   - manual observations kept outside authoritative race facts;
   - exact-value economic transactions, allocations and reconciliation records.

3. **Schema detection and staged validation — complete**
   - source selection plus header-based detection;
   - versioned aliases, encoding status and source-column provenance;
   - quarantine of malformed or ambiguous input;
   - count-only/redacted logs.

4. **Synthetic source adapters and transactional acceptance — complete**
   - Race Merge, Core Details, Current Vault and Current Arena adapters;
   - cumulative deduplication, conflict quarantine and redacted warnings;
   - immutable dataset-version activation and reversible rollback contract;
   - separate data current-through, import completion and aggregate refresh timestamps;
   - owner/source-locked PostgreSQL activation, provenance and failure rollback;
   - PostgreSQL 16 exact replay, conflict, stale, snapshot, RLS and rollback verification;
   - normalized Race Merge staging and atomic event/entry materialization;
   - normalized Core Details and parent-edge materialization with cumulative rollback;
   - Current Vault and Current Arena historical-snapshot materialization with exact rollback;
   - source-semantic preservation without guessed elapsed-time or economic conversion;
   - materialized fact deactivation and restoration during cumulative rollback.

5. **Derived integrity pipelines — in progress**
   - event-level Gold/Blue assignment validation — contract complete;
   - 1–3 gate Gold-ineligibility protection — contract complete;
   - deterministic, idempotent star-profile refresh with explicit denominators
     — provider-independent contract and PostgreSQL aggregate materialization complete;
   - manual-observation reconciliation without duplicate evidence — complete;
   - race fee/payout quarantine until source semantics are validated;
   - lineage graph and family-restriction validation — complete.

6. **Private import UI and recovery — in progress**
   - owner-only historical status workspace — provider-independent contract complete;
   - private upload — gated until approved Preview services are configured;
   - count/code-only schema and error summaries — complete;
   - freshness and historical-snapshot wording — complete;
   - rollback and reconciliation queue projection — complete;
   - authenticated mutations and persistent Preview verification — pending.

7. **Phase 1 verification and Gate B evidence — client action required**
   - repeated-import, rollback, anomaly, freshness, observation and economic-key tests — complete;
   - migration, security, build and accessibility checks — complete;
   - synthetic representative import evidence — complete;
   - source fee/payout semantics — awaiting authoritative owner confirmation;
   - Preview storage path and maximum spend — awaiting owner approval;
   - exact client actions for Preview-only Clerk, Neon, R2 and Vercel — documented;
   - no full private-data upload until Gate B is satisfied.

## Invariants carried forward

- Source IDs are authoritative; ambiguous name matches remain reviewable.
- The Bike-labelled details export is Core Details, and `bikeid` is a legacy source alias.
- Missing, false, invalid and Gold-ineligible star states remain distinct.
- `gold_star_eligible = gate_count > 3`.
- Manual post-lock observations are excluded from permanent aggregates until authoritative reconciliation.
- Unlike assets remain separate, BGC remains non-cash by default and transfers remain outside operating P/L.
- Imported timestamps describe historical snapshots, not live game state.
- Production, paid services and private-data hosting remain gated.
