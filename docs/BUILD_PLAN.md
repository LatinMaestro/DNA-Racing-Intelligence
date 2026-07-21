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
- synthetic test fixtures.

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
- aggregate refresh jobs.

Exit: synthetic and representative sanitized imports pass, repeated imports produce no duplicates, lineage rules test correctly.

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
- qualification dashboard.

Exit: recent Horse Maiden example can be represented without code changes.

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
- probabilistic exceptional-offspring analysis.

Exit: saturated vault categories do not suppress high-upside pairing recommendations.

## Phase 7 — Lifecycle adviser

Deliver:

- race/discover/Maiden/breed/hold/sell/burn recommendations;
- Genesis burn exclusion;
- unresolved-evidence protections;
- duplicate-role and vault-depth analysis.

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
- private production-readiness checklist.

Exit: all Definition of Done requirements pass and Production remains gated pending owner approval.

## Suggested architecture to validate in Phase 0

- Next.js App Router, TypeScript strict mode, Tailwind and accessible component primitives.
- PostgreSQL/Neon for application state and durable aggregates.
- Object storage for private raw uploads if needed.
- Python plus DuckDB/Polars for batch analytics where this materially improves large-file processing.
- Background or queued import/aggregate jobs rather than request-time full-history analysis.
- Vercel Preview deployments.

Codex may propose a different low-cost architecture, but must document why it better satisfies privacy, scale, maintainability and online-only operation before changing this direction.
