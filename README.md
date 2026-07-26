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

Phase 0 and the repository-only Phase 1 foundations are merged. Exact owned-core race economics and historical USD-rate controls are implemented with synthetic verification. Phase 2 core-performance work is in progress while the first full private hosted import remains separately gated by Preview configuration and capacity evidence. Production remains disabled and requires explicit Gate F approval.

## Source-of-truth documents

- [`AGENTS.md`](AGENTS.md) — autonomous agent operating instructions
- [`docs/MASTER_SPECIFICATION.md`](docs/MASTER_SPECIFICATION.md) — complete product requirements
- [`docs/GAME_RULES.md`](docs/GAME_RULES.md) — confirmed DNA Racing mechanics
- [`docs/STAR_SIGNAL_SPECIFICATION.md`](docs/STAR_SIGNAL_SPECIFICATION.md) — Gold/Blue database, Gold gate eligibility, field-relative analytics, freshness and no-leakage requirements
- [`docs/OPEN_RACE_WORKFLOW.md`](docs/OPEN_RACE_WORKFLOW.md) — pre-entry selection, post-lock star observation and import-reconciliation requirements
- [`docs/ANALYTICS_METHOD.md`](docs/ANALYTICS_METHOD.md) — statistical and recommendation methodology
- [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) — imports, provenance and privacy controls
- [`docs/DATA_UPDATE_WORKFLOW.md`](docs/DATA_UPDATE_WORKFLOW.md) — owner-facing periodic upload, preview, activation, retention and rollback workflow
- [`docs/AGGREGATE_SOURCE_PROFILE.md`](docs/AGGREGATE_SOURCE_PROFILE.md) — privacy-safe source counts, coverage, overlap and confirmed import treatment
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
- [`docs/PHASE_1_STAR_PROFILE_MATERIALIZATION.md`](docs/PHASE_1_STAR_PROFILE_MATERIALIZATION.md) — durable event validation and count-based star profiles
- [`docs/PHASE_1_STAR_OBSERVATION_RECONCILIATION.md`](docs/PHASE_1_STAR_OBSERVATION_RECONCILIATION.md) — idempotent post-lock observation reconciliation
- [`docs/PHASE_1_LINEAGE_GRAPH.md`](docs/PHASE_1_LINEAGE_GRAPH.md) — owner-scoped lineage graph and exact confirmed family restrictions
- [`docs/PHASE_1_CORE_MATERIALIZATION.md`](docs/PHASE_1_CORE_MATERIALIZATION.md) — atomic Core Details and parent-edge persistence with rollback
- [`docs/PHASE_1_SNAPSHOT_MATERIALIZATION.md`](docs/PHASE_1_SNAPSHOT_MATERIALIZATION.md) — reversible Current Vault and Arena historical snapshots
- [`docs/PHASE_1_IMPORT_RECOVERY_UI.md`](docs/PHASE_1_IMPORT_RECOVERY_UI.md) — private import status, freshness and recovery workspace contract
- [`docs/PHASE_1_DATA_UPDATE_PREVIEW.md`](docs/PHASE_1_DATA_UPDATE_PREVIEW.md) — grouped owner upload preview and explicit confirmation contract
- [`docs/PHASE_1_IMPORT_READ_MODEL_SERVICE.md`](docs/PHASE_1_IMPORT_READ_MODEL_SERVICE.md) — owner-scoped fail-closed application service for historical import status
- [`docs/PHASE_1_PRIVATE_RAW_OBJECT_STREAMING.md`](docs/PHASE_1_PRIVATE_RAW_OBJECT_STREAMING.md) — bounded private raw-object integrity and transactional staging contract
- [`docs/PHASE_1_IMPORT_UPLOAD_INTAKE_SERVICE.md`](docs/PHASE_1_IMPORT_UPLOAD_INTAKE_SERVICE.md) — owner-scoped guarded direct private-object upload intake contract
- [`docs/PHASE_1_IMPORT_UPLOAD_COMPLETION_SERVICE.md`](docs/PHASE_1_IMPORT_UPLOAD_COMPLETION_SERVICE.md) — owner-scoped direct-upload verification and preview-dispatch contract
- [`docs/PHASE_1_IMPORT_PREVIEW_PROCESSING_SERVICE.md`](docs/PHASE_1_IMPORT_PREVIEW_PROCESSING_SERVICE.md) — manifest-bound bounded background preview-processing contract
- [`docs/PHASE_1_IMPORT_OWNER_ACTION_SERVICE.md`](docs/PHASE_1_IMPORT_OWNER_ACTION_SERVICE.md) — authenticated owner-session boundary for guarded upload intake and completion
- [`docs/PHASE_1_IMPORT_SERVER_ACTION_ADAPTER.md`](docs/PHASE_1_IMPORT_SERVER_ACTION_ADAPTER.md) — fail-closed Next.js Server Action transport for import intake and completion
- [`docs/PHASE_1_IMPORT_DIRECT_UPLOAD_CLIENT.md`](docs/PHASE_1_IMPORT_DIRECT_UPLOAD_CLIENT.md) — bounded provider-neutral browser transfer orchestration for reserved private objects
- [`docs/PHASE_1_IMPORT_FILE_PREPARATION_CLIENT.md`](docs/PHASE_1_IMPORT_FILE_PREPARATION_CLIENT.md) — bounded incremental checksum preparation for private browser-selected exports
- [`docs/PHASE_1_IMPORT_CONFIRMATION_ACTION.md`](docs/PHASE_1_IMPORT_CONFIRMATION_ACTION.md) — authenticated explicit-preview confirmation and guarded dispatch boundary
- [`docs/PHASE_1_IMPORT_RECOVERY_ACTION.md`](docs/PHASE_1_IMPORT_RECOVERY_ACTION.md) — authenticated reasoned rollback transport with provenance retention
- [`docs/PHASE_1_IMPORT_AGGREGATE_RETRY_ACTION.md`](docs/PHASE_1_IMPORT_AGGREGATE_RETRY_ACTION.md) — authenticated failed aggregate-refresh retry and queue boundary
- [`docs/PHASE_1_IMPORT_PROGRESS_UI.md`](docs/PHASE_1_IMPORT_PROGRESS_UI.md) — owner-scoped progress, completion and disabled recovery interface
- [`docs/PHASE_1_IMPORT_PROVIDER_ADAPTER_BUNDLE.md`](docs/PHASE_1_IMPORT_PROVIDER_ADAPTER_BUNDLE.md) — lazy owner-bound provider readiness and initialization contract
- [`docs/PHASE_1_IMPORT_PERSISTENCE_OPERATION_ADAPTER.md`](docs/PHASE_1_IMPORT_PERSISTENCE_OPERATION_ADAPTER.md) — owner-scoped transaction, forced-RLS and durable-operation contract
- [`docs/PHASE_1_AGGREGATE_REFRESH_SERVICE.md`](docs/PHASE_1_AGGREGATE_REFRESH_SERVICE.md) — source-version-bound aggregate refresh and atomic publication contract
- [`docs/PHASE_1_GATE_B_EVIDENCE.md`](docs/PHASE_1_GATE_B_EVIDENCE.md) — Gate B evidence, cost boundary and consolidated client actions
- [`docs/PHASE_1_RACE_ECONOMICS.md`](docs/PHASE_1_RACE_ECONOMICS.md) — owner-confirmed race economics, USD valuation and R2/Neon placement
- [`docs/PHASE_2_CORE_PERFORMANCE.md`](docs/PHASE_2_CORE_PERFORMANCE.md) — exact mode-distance performance profile contract and evidence boundary
- [`docs/PHASE_2_CORE_READ_WORKSPACE.md`](docs/PHASE_2_CORE_READ_WORKSPACE.md) — owner-scoped compact-profile application service and historical interface
- [`docs/PHASE_2A_VAULT_PERFORMANCE_WORKSPACE.md`](docs/PHASE_2A_VAULT_PERFORMANCE_WORKSPACE.md) — owner-scoped materialized economic summary service and private interface
- [`docs/PHASE_3_DISCOVERY_WORKSPACE.md`](docs/PHASE_3_DISCOVERY_WORKSPACE.md) — owner-scoped exact-distance probe review service and non-actionable interface
- [`docs/PHASE_2_VAULT_REGISTRY.md`](docs/PHASE_2_VAULT_REGISTRY.md) — confirmed-ID ownership, manual edit and Maiden override projection contract
- [`docs/PHASE_2_VAULT_IDENTITY_RESOLUTION.md`](docs/PHASE_2_VAULT_IDENTITY_RESOLUTION.md) — deterministic owner-confirmed Vault-to-Core Details identity contract
- [`docs/PHASE_2_VAULT_READ_WORKSPACE.md`](docs/PHASE_2_VAULT_READ_WORKSPACE.md) — owner-scoped Vault application service and historical-snapshot interface
- [`docs/PHASE_2_CORE_SOURCE_COVERAGE.md`](docs/PHASE_2_CORE_SOURCE_COVERAGE.md) — explicit Core Details, race-history, Vault, Arena and lineage coverage states
- [`docs/PHASE_6_BREEDING_ECONOMIC_WRITE_SERVICE.md`](docs/PHASE_6_BREEDING_ECONOMIC_WRITE_SERVICE.md) — owner-scoped completed breeding economics and optional offspring cost-basis write boundary
- [`docs/PHASE_7_LIFECYCLE_ECONOMIC_WRITE_SERVICE.md`](docs/PHASE_7_LIFECYCLE_ECONOMIC_WRITE_SERVICE.md) — owner-scoped core sale, burn and actual BGC credit write boundary
- [`docs/OFFLINE_INTEGRATION_REHEARSAL.md`](docs/OFFLINE_INTEGRATION_REHEARSAL.md) — prerequisite and Phase 2–9 composition, defect resolution, validation evidence and remaining database boundary
- [`CODEX_START_PROMPT.md`](CODEX_START_PROMPT.md) — initial autonomous Codex handover prompt

## Privacy

Real race, vault, core, arena and economic exports are confidential and must not be committed to Git. Development and tests must use synthetic fixtures. The deployed product is private, authenticated and non-indexed. The application must never request crypto private keys or seed phrases and must not initiate wallet or game transactions.
