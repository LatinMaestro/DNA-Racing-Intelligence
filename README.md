# DNA Racing Intelligence

Private, single-user decision-support and analytics platform for improving the repository owner’s DNA Racing vault.

The product will analyse periodically imported historical race times, Gold/Blue pre-race star signals, lineage, current-vault snapshots, latest arena snapshots, user-configured tournament qualification rules and recorded economic activity to support:

- tournament and Auto-Entry selection;
- Maiden Eligible strategy;
- targeted mode and distance discovery;
- whole-core and field-relative star analysis;
- vault profit/loss and economic performance tracking;
- breeding and arena partner selection;
- open-race comparison; and
- race, retain, breed, sell or burn decisions.

The application is not connected to live DNA Racing data. Race exports are expected to be refreshed approximately every few days, and all imported-data views must display their current-through date and freshness.

For an Open Race, current-race Gold and Blue stars are unavailable while the field is forming. They appear only after all gates are filled and the race is set to run, so they cannot be used to choose or switch the entered core.

## Repository status

Phase 0 architecture, privacy controls and the private application scaffold are merged and Gate A is accepted. Phase 1 data-foundation delivery is in progress under the owner's standing autonomous authority. Production remains disabled and requires separate explicit Gate F approval.

## Source-of-truth documents

- [`AGENTS.md`](AGENTS.md) — autonomous agent operating instructions
- [`docs/MASTER_SPECIFICATION.md`](docs/MASTER_SPECIFICATION.md) — complete product requirements
- [`docs/GAME_RULES.md`](docs/GAME_RULES.md) — confirmed DNA Racing mechanics
- [`docs/STAR_SIGNAL_SPECIFICATION.md`](docs/STAR_SIGNAL_SPECIFICATION.md) — Gold/Blue database, Gold gate eligibility, field-relative analytics, freshness and no-leakage requirements
- [`docs/OPEN_RACE_WORKFLOW.md`](docs/OPEN_RACE_WORKFLOW.md) — pre-entry selection, post-lock star observation and import-reconciliation requirements
- [`docs/ANALYTICS_METHOD.md`](docs/ANALYTICS_METHOD.md) — statistical and recommendation methodology
- [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) — imports, provenance and privacy controls
- [`docs/VAULT_PERFORMANCE_ACCOUNTING.md`](docs/VAULT_PERFORMANCE_ACCOUNTING.md) — vault P/L, BGC, manual payouts and economic-ledger requirements
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — phased implementation plan
- [`docs/REVIEW_GATES.md`](docs/REVIEW_GATES.md) — points requiring owner approval
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) — completion and quality standard
- [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) — confirmed decisions and corrections
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Phase 0 system, data, no-leakage and cost decisions
- [`docs/PRIVACY_AND_THREAT_MODEL.md`](docs/PRIVACY_AND_THREAT_MODEL.md) — private data flow, threats, controls and retention proposal
- [`docs/PHASE_0_HANDOFF.md`](docs/PHASE_0_HANDOFF.md) — Phase 0 validation, limitations and Gate A status
- [`docs/PHASE_1_IMPLEMENTATION_PLAN.md`](docs/PHASE_1_IMPLEMENTATION_PLAN.md) — focused data-foundation delivery slices and Gate B boundary
- [`docs/PHASE_1_DATA_MODEL.md`](docs/PHASE_1_DATA_MODEL.md) — owner-scoped PostgreSQL schema, migration and verification contract
- [`docs/PHASE_1_SCHEMA_DETECTION.md`](docs/PHASE_1_SCHEMA_DETECTION.md) — versioned header detection, encoding and fail-closed quarantine contract
- [`docs/PHASE_1_SOURCE_ADAPTERS.md`](docs/PHASE_1_SOURCE_ADAPTERS.md) — conservative typed row adapters and private provenance boundary
- [`docs/PHASE_1_STAR_INTEGRITY.md`](docs/PHASE_1_STAR_INTEGRITY.md) — event validation and deterministic star-profile refresh contract
- [`docs/PHASE_1_RACE_MATERIALIZATION.md`](docs/PHASE_1_RACE_MATERIALIZATION.md) — transaction-safe normalized Race Merge persistence and rollback
- [`CODEX_START_PROMPT.md`](CODEX_START_PROMPT.md) — initial autonomous Codex handover prompt

## Privacy

Real race, vault, core, arena and economic exports are confidential and must not be committed to Git. Development and tests must use synthetic fixtures. The deployed product is private, authenticated and non-indexed. The application must never request crypto private keys or seed phrases and must not initiate wallet or game transactions.
