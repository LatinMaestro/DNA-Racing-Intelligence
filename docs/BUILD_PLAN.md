# Build Plan

## Delivery approach

Use focused pull requests, online-only development and hosted previews. Continue autonomously through approved work until a review gate or external account action is required.

## Phase 0 — Governance and architecture

Deliver:

- repository control documents;
- architecture decision record;
- threat/privacy model;
- application scaffold;
- CI, lint, typecheck and tests;
- private-by-default deployment configuration;
- synthetic test fixtures;
- placeholder navigation for every approved module, including Vault Performance.

Exit: documentation accepted, scaffold verified and no private data committed.

## Phase 1 — Data foundation

Deliver:

- schema and migrations;
- upload interface;
- file-type detection and validation;
- batch provenance;
- idempotent race deduplication;
- core, vault and arena imports;
- lineage graph;
- import summaries and rollback;
- aggregate refresh jobs;
- financial-ledger foundations supporting race-derived and manual provenance;
- decimal-safe asset/currency storage;
- tournament/stage classification foundations.

Exit: synthetic and representative sanitized imports pass, repeated imports produce no duplicates, lineage rules test correctly, and financial source records can be linked without double counting.

## Phase 2 — Vault and core intelligence

Deliver:

- current vault lock and manual edits;
- ME overrides;
- core profiles;
- bike/car/horse separation;
- exact-distance and band summaries;
- time, speed, variance and benchmark percentiles;
- family tree explorer;
- evidence confidence.

Exit: all active owned cores resolve to profiles or clear data warnings.

## Phase 2B — Vault Performance and financial ledger

Deliver:

- private transaction ledger;
- race-derived entry-fee and payout records for owned cores;
- open-racing, tournament-qualification, automatic-round and grand-final classification;
- manual tournament award entry for payouts sent directly to crypto wallets;
- arena-fee income entry;
- breeding-cost entry with DNA fee, external arena fee and BGC components;
- core sale and acquisition entry;
- BGC burn-credit and arena-spend ledger;
- manual adjustments and reconciliation states;
- possible-duplicate detection between exports and manual records;
- native-currency P/L and activity summaries;
- optional reporting-currency conversion with source/effective date;
- per-core and per-tournament financial drill-down;
- data completeness and unclassified-activity warnings.

Rules:

- BGC remains separate from cash/crypto profit by default;
- do not combine unlike currencies without explicit conversion;
- do not recognise an arena listing as income;
- do not fabricate cost basis or missing payouts;
- all totals must drill down to source or manual entries.

Exit: synthetic race fees/payouts reconcile idempotently; manual tournament awards can be recorded without duplication; BGC remains separate; mixed-currency totals are safe; and every summary is auditable.

## Phase 3 — Discovery

Deliver:

- evidence matrix by core × mode × distance;
- minimum-10 rule;
- lineage-informed hypotheses;
- targeted probe recommendations;
- early stop/continue logic;
- unexpected-outlier probes;
- tournament-driven and ME-priority discovery.

Exit: recommendations are explainable and backtested against historical holdout periods.

## Phase 4 — Tournament configuration and optimiser

Deliver:

- tournament and bracket builder;
- element/breed/F-number grouping;
- fastest, median, points and custom qualification metrics;
- candidate ranking;
- Auto-Entry allocation suggestions;
- adaptive stop/continue guidance;
- 50%-gate cap warning without targeting the cap;
- qualification dashboard;
- linkage between configured tournament windows and Vault Performance classifications.

Exit: recent Horse Maiden example can be represented without code changes, and qualification financial activity can be mapped to the configured event.

## Phase 5 — Maiden strategy

Deliver:

- ME inventory and lifecycle;
- cross-mode Maiden comparison;
- preserve-ME recommendations;
- bracket-specific suitability;
- commitment warnings;
- planned/committed/consumed tracking;
- entire-vault opportunity allocation.

Exit: a core with stronger Car than Horse potential is correctly held from a Horse Maiden.

## Phase 6 — Breeding intelligence

Deliver:

- breeding-rule engine;
- family eligibility;
- class, element and F-number outcomes;
- cycles and splice caps;
- base and arena fee calculator;
- active arena scanner;
- parent-offspring research pipeline;
- elite-upside, vault-gap and balanced rankings;
- probabilistic exceptional-offspring analysis;
- optional creation of linked breeding-cost ledger entries without performing a game transaction.

Exit: saturated vault categories do not suppress high-upside pairing recommendations.

## Phase 7 — Lifecycle adviser

Deliver:

- race/discover/Maiden/breed/hold/sell/burn recommendations;
- Genesis burn exclusion;
- unresolved-evidence protections;
- duplicate-role and vault-depth analysis;
- links to recorded sale or BGC burn outcomes without using BGC value as the lifecycle objective.

Exit: every active core has an explainable lifecycle status or an explicit insufficient-evidence state.

## Phase 8 — Open Race tool

Deliver:

- manual race and opponent entry;
- eligibility filtering;
- pairwise/field time comparison;
- recommended owned core and avoid signal.

Exit: synthetic opponent fields produce deterministic tested outputs.

## Phase 9 — Validation and hardening

Deliver:

- chronological backtests;
- benchmark comparisons;
- calibration and uncertainty reports;
- performance optimisation for multi-million-row history;
- security review;
- import recovery tests;
- financial-ledger reconciliation and precision tests;
- private production-readiness checklist.

Exit: all Definition of Done requirements pass and Production remains gated pending owner approval.

## Suggested architecture to validate in Phase 0

- Next.js App Router, TypeScript strict mode, Tailwind and accessible component primitives.
- PostgreSQL/Neon for application state, financial ledger and durable aggregates.
- Object storage for private raw uploads if needed.
- Python plus DuckDB/Polars for batch analytics where this materially improves large-file processing.
- Background or queued import/aggregate jobs rather than request-time full-history analysis.
- Vercel Preview deployments.

Codex may propose a different low-cost architecture, but must document why it better satisfies privacy, scale, financial integrity, maintainability and online-only operation before changing this direction.