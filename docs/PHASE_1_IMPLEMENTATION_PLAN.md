# Phase 1 Implementation Plan

Date: 22 July 2026  
Status: in progress  
Production: disabled and fail-closed

## Boundary

Phase 1 establishes the private, idempotent and auditable data foundation. It does not present analytical recommendations or dependable financial totals. Repository tests use synthetic fixtures only. Full private-data hosting remains blocked until Gate B evidence is complete and the required client account actions are available.

## Focused delivery slices

1. **Import contracts and deterministic keys**
   - typed source and batch states;
   - checksum, timestamp and row-count invariants;
   - legacy Core Details `bikeid` alias handling;
   - stable race-entry and race-economic keys;
   - authoritative versus candidate-only manual star-observation matching.

2. **PostgreSQL schema and reversible migration**
   - owner, asset, core, lineage and source-provenance records;
   - import manifests, warnings and accepted dataset versions;
   - nullable Gold/Blue facts, explicit Gold eligibility and star-data status;
   - manual observations kept outside authoritative race facts;
   - exact-value economic transactions, allocations and reconciliation records.

3. **Schema detection and staged validation**
   - source selection plus header-based detection;
   - versioned aliases, encoding status and source-column provenance;
   - quarantine of malformed or ambiguous input;
   - count-only/redacted logs.

4. **Synthetic source adapters and transactional acceptance**
   - Race Merge, Core Details, Current Vault and Current Arena adapters;
   - cumulative deduplication and conflict warnings;
   - dataset-version activation and rollback;
   - latest accepted event, import completion and aggregate refresh timestamps.

5. **Derived integrity pipelines**
   - event-level Gold/Blue assignment validation;
   - 1–3 gate Gold-ineligibility protection;
   - idempotent star-profile refresh;
   - manual-observation reconciliation without duplicate evidence;
   - race fee/payout quarantine until source semantics are validated;
   - lineage graph and family-restriction validation.

6. **Private import UI and recovery**
   - owner-only upload and batch status;
   - schema/error summaries without raw-row exposure;
   - freshness and historical-snapshot wording;
   - rollback and reconciliation queues.

7. **Phase 1 verification and Gate B evidence**
   - repeated-import, rollback, anomaly, freshness, observation and economic-key tests;
   - migration, security, build and accessibility checks;
   - sanitized representative import evidence;
   - exact client actions for Preview-only Clerk, Neon, R2 and Vercel configuration;
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
