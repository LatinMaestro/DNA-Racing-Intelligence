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
- database design for raw and normalized Gold/Blue star fields;
- Gold-star eligibility design using gate count greater than three;
- event-level star assignment validation design;
- durable star-profile and pre-race field-quality aggregate strategy;
- import timestamp, latest accepted event timestamp and freshness-state design;
- historical-snapshot UI rules that prohibit live-data wording;
- architecture for a currency-aware auditable economic ledger;
- exact-value storage strategy for currencies, crypto assets and BGC;
- private manual transaction and tournament-payout entry design; and
- placeholder navigation for Vault Performance.

Exit: documentation accepted, scaffold verified, star-signal, freshness and accounting architecture are documented and no private data is committed.

## Phase 1 — Data foundation

Deliver:

- schema and migrations;
- upload interface;
- file-type detection and validation;
- batch provenance;
- import and source coverage timestamps;
- idempotent race deduplication;
- raw and normalized `gold_star`/`blue_star` preservation;
- normalized `gold_star_eligible` derived from gate count;
- distinction between false, missing, ineligible and invalid star data;
- event-level assignment-count validation and anomaly warnings;
- explicit warning for any source Gold assignment at three gates or fewer;
- core, vault and arena imports;
- lineage graph;
- import summaries and rollback;
- aggregate refresh jobs;
- current-through, last-imported and data-age derivation;
- economic transaction, allocation, asset/currency and reconciliation foundations;
- race-derived entry-fee and payout transaction pipeline;
- import-safe economic natural keys; and
- manual transaction source/provenance foundations.

Exit: synthetic and representative sanitized imports pass, repeated imports produce no duplicate race/star/economic records, 1–3 gate races are correctly Gold-ineligible, freshness metadata is accurate, anomalies are surfaced, economic entries do not double count and lineage rules test correctly.

## Phase 2 — Vault and core intelligence

Deliver:

- current vault lock and manual edits;
- ME overrides;
- core profiles;
- bike/car/horse separation;
- exact-distance and band summaries;
- time, speed, variance and benchmark percentiles;
- Gold/Blue counts and rates by mode and exact distance;
- Gold-eligible counts and explicit denominators;
- both-star, exclusive-star and neither-star summaries;
- strong-field star and weak-field eligible no-star context;
- trend and detected algorithm-era views;
- data current-through and freshness display;
- family tree explorer;
- evidence confidence.

Exit: all active owned cores resolve to profiles or clear data warnings, every Gold/Blue rate is auditable with eligibility and denominator, and no race-derived view implies live coverage.

## Phase 2A — Vault Performance and accounting

Deliver:

- private economic ledger;
- manual income, expense, transfer, opening-balance and adjustment entry;
- normal open-racing entry-fee, payout and net reporting;
- currency/asset-separated totals;
- separate BGC ledger and opening balance;
- BGC burn-credit and arena-fee-spend recording;
- manual game-owner tournament payout entry;
- breeding income and expense entry;
- core purchase, sale, burn and cost-basis entry;
- duplicate detection, reversal and reconciliation controls;
- Vault Performance dashboard;
- core economic profile;
- completeness and partial-result warnings;
- data coverage/freshness display; and
- timeframe, core, mode, distance, category and currency filters.

Do not infer completed breeding income from arena listings. Do not silently value BGC or unsold cores as cash. Exclude deposits, withdrawals and internal transfers from operating P/L.

Exit: synthetic multi-currency, BGC, manual payout, sale-without-cost-basis and cumulative-import scenarios reconcile correctly and no report overstates completeness or freshness.

## Phase 3 — Discovery

Deliver:

- evidence matrix by core × mode × distance;
- minimum-10 rule;
- lineage-informed hypotheses;
- targeted probe recommendations;
- early stop/continue logic;
- unexpected-outlier probes;
- Gold/Blue star evidence in early samples;
- Gold eligibility handling;
- field-relative star strength using historical pre-race information only;
- negative no-star evidence against weak eligible fields without automatic rejection;
- time/star agreement and mismatch explanations;
- imported-data freshness in each recommendation;
- tournament-driven and ME-priority discovery.

Exit: recommendations are explainable and backtested against historical holdout periods, current-event outcomes never leak into field-strength features, 1–3 gate races never count against Gold performance, and no-star evidence alone cannot stop or burn a core.

## Phase 4 — Tournament configuration and optimiser

Deliver:

- tournament and bracket builder;
- element/breed/F-number grouping;
- fastest, median, points and custom qualification metrics;
- candidate ranking;
- imported historical star evidence as supporting rationale;
- Auto-Entry allocation suggestions;
- adaptive stop/continue guidance;
- 50%-gate cap warning without targeting the cap;
- qualification dashboard;
- explicit warning that imported data is not the live qualifying field;
- classification of imported races into qualification, automated rounds and finals;
- tournament campaign linking and correction workflow;
- tournament campaign economic reporting;
- bracket and leaderboard financial attribution where supportable; and
- manual external prize reconciliation with imported payouts.

Exit: recent Horse Maiden example can be represented without code changes, star evidence never replaces the configured ranking metric, the UI does not imply live occupancy, and a synthetic tournament campaign reconciles without double counting.

## Phase 5 — Maiden strategy

Deliver:

- ME inventory and lifecycle;
- cross-mode Maiden comparison;
- preserve-ME recommendations;
- bracket-specific suitability;
- commitment warnings;
- planned/committed/consumed tracking;
- strong-field star support for limited-sample ME cores;
- protection against star-only recommendations where time evidence is poor;
- data freshness warning for Maiden decisions;
- entire-vault opportunity allocation.

Exit: a core with stronger Car than Horse potential is correctly held from a Horse Maiden, star evidence is supporting only, and the recommendation discloses the imported-data cutoff.

## Phase 6 — Breeding intelligence

Deliver:

- breeding-rule engine;
- family eligibility;
- class, element and F-number outcomes;
- cycles and splice caps;
- base and arena fee calculator;
- latest-import arena scanner with freshness/expiry warnings;
- parent-offspring research pipeline;
- parent and lineage Gold/Blue star-profile features;
- chronological test of whether star features add predictive lift beyond time-only baselines;
- elite-upside, vault-gap and balanced rankings;
- probabilistic exceptional-offspring analysis;
- actual breeding-income and expense ledger integration; and
- optional offspring cost-basis assignment from actual pairing costs.

Exit: saturated vault categories do not suppress high-upside pairings, imported arena listings are never presented as live or completed income, and star propensity is not described as inherited unless validated.

## Phase 7 — Lifecycle adviser

Deliver:

- race/discover/Maiden/breed/hold/sell/burn recommendations;
- Genesis burn exclusion;
- unresolved-evidence protections;
- duplicate-role and vault-depth analysis;
- star-supported lifecycle explanations;
- rule preventing no-star or Gold-ineligible evidence alone from causing a burn recommendation;
- sale, burn and BGC ledger integration; and
- clear separation between strategic burn advice and actual manually recorded burn credit.

Exit: every active core has an explainable lifecycle status or an explicit insufficient-evidence state.

## Phase 8 — Open Race tool

Deliver:

- manual race and opponent entry;
- optional manual identification of the currently displayed Gold-star and Blue-star cores;
- eligibility filtering;
- pairwise/field time comparison;
- star-aware field context without assuming the website can fetch authenticated game data;
- explicit manual/current-input labeling distinct from imported history;
- recommended owned core and avoid signal.

Exit: synthetic opponent fields and optional manually entered current-star assignments produce deterministic tested outputs.

## Phase 9 — Validation and hardening

Deliver:

- chronological backtests;
- benchmark comparisons;
- calibration and uncertainty reports;
- Gold top-three and Blue win conversion reports;
- incremental predictive-lift reports;
- strong-field star and weak-field eligible no-star validation;
- Gold gate-eligibility tests;
- star-algorithm era/change detection;
- explicit current-event and future-leakage tests;
- freshness and stale-data behavior tests;
- no-live-wording checks for imported views;
- performance optimisation for multi-million-row history;
- security review;
- import recovery tests;
- economic reconciliation and multi-currency audit tests;
- incomplete-data and duplicate-payout tests;
- private production-readiness checklist.

Exit: all Definition of Done requirements pass and Production remains gated pending owner approval.

## Suggested architecture to validate in Phase 0

- Next.js App Router, TypeScript strict mode, Tailwind and accessible component primitives.
- PostgreSQL/Neon for application state, economic ledger and durable aggregates.
- Nullable normalized Gold/Blue fields plus raw source provenance.
- Gold eligibility derived from gate count and tested at import/analytics boundaries.
- Precomputed core star profiles and time-aware pre-race field-quality features.
- Durable import/current-through timestamps and freshness-state derivation.
- Exact decimal/numeric or integer minor-unit storage appropriate to each asset.
- Object storage for private raw uploads if needed.
- Python plus DuckDB/Polars for batch analytics where this materially improves large-file processing.
- Background or queued import/aggregate jobs rather than request-time full-history analysis.
- Vercel Preview deployments.

Codex may propose a different low-cost architecture, but must document why it better satisfies privacy, scale, analytical no-leakage, snapshot freshness, accounting correctness, maintainability and online-only operation before changing this direction.
