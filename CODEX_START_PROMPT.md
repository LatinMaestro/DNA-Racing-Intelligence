# Initial Codex Prompt

Copy the prompt below into Codex after the documentation PR is merged.

---

You are the autonomous implementation agent for the private repository `LatinMaestro/DNA-Racing-Intelligence`.

Your objective is to build the private single-user **DNA Racing Intelligence** website in controlled phases, using GitHub and hosted services only. The user does not want local development, local database setup or local application execution on their computer.

## Mandatory first action

Before changing anything, read every repository control document in full:

- `AGENTS.md`
- `README.md`
- `docs/MASTER_SPECIFICATION.md`
- `docs/GAME_RULES.md`
- `docs/STAR_SIGNAL_SPECIFICATION.md`
- `docs/OPEN_RACE_WORKFLOW.md`
- `docs/ANALYTICS_METHOD.md`
- `docs/DATA_CONTRACT.md`
- `docs/DATA_UPDATE_WORKFLOW.md`
- `docs/AGGREGATE_SOURCE_PROFILE.md`
- `docs/VAULT_PERFORMANCE_ACCOUNTING.md`
- `docs/BUILD_PLAN.md`
- `docs/REVIEW_GATES.md`
- `docs/DEFINITION_OF_DONE.md`
- `docs/DECISION_LOG.md`

Treat those documents as the approved source of truth. `docs/STAR_SIGNAL_SPECIFICATION.md`, `docs/OPEN_RACE_WORKFLOW.md` and `docs/VAULT_PERFORMANCE_ACCOUNTING.md` are additive approved specifications and must not be omitted merely because the earlier master specification predates them. Do not omit or simplify confirmed game mechanics. Do not substitute your own assumptions where the documents are explicit.

## Operating direction

Proceed autonomously through the phased plan using focused branches and pull requests. Do not wait for approval between ordinary implementation slices where the repository documents already provide clear direction. Stop only at an explicit review gate or where you require:

- an account action;
- a secret;
- approval for a paid service;
- a production deployment or irreversible production migration;
- upload of the user’s full private datasets;
- a material architecture departure;
- clarification of a game rule that cannot safely remain configurable;
- permission to weaken privacy or expose a route publicly.

Production must remain disabled or fail-closed until explicit owner approval.

Do not merge your own pull requests unless the owner later gives a standing instruction allowing it. Open reviewable PRs and continue with the next safe independent planning or implementation task where possible.

## Immediate scope: Phase 0 only

Begin with **Phase 0 — Governance and architecture**. Do not jump directly into the complete analytics system.

### Phase 0 tasks

1. Inspect repository truth and confirm it currently contains documentation only.
2. Propose and document the detailed architecture, including:
   - Next.js App Router and TypeScript strict mode;
   - UI system and responsive private dashboard structure;
   - authentication for one private user;
   - PostgreSQL/Neon application database;
   - safe private raw-upload storage strategy;
   - Python plus DuckDB or Polars batch analytics where appropriate;
   - background import and aggregate processing;
   - Vercel Preview deployments;
   - estimated free-tier limits and likely future costs;
   - how multi-million-row race history will avoid request-time full scans;
   - nullable normalized Gold/Blue race-entry star fields with raw provenance;
   - `gold_star_eligible` derived from gate count greater than three;
   - event-level star assignment validation and efficient core star-profile aggregates;
   - chronological pre-race field-quality features that prevent outcome leakage;
   - optional post-lock/manual star observations kept separate from imported history until reconciliation;
   - import timestamp, latest accepted event timestamp and dataset freshness status;
   - explicit historical-snapshot UI treatment rather than live-data wording;
   - a currency-aware auditable economic ledger;
   - exact decimal or integer-minor-unit storage for currencies, tokens and BGC;
   - manual economic transaction and tournament-payout entry;
   - race-derived entry-fee and payout transactions;
   - duplicate/reconciliation controls; and
   - separation of cash/crypto P/L, BGC movement, transfers and optional future valuations.
3. Add architecture and privacy documentation, including a threat model and data-flow diagram in Markdown/Mermaid. The threat model must explicitly exclude storage of crypto private keys, seed phrases or signing credentials.
4. Scaffold the application with:
   - TypeScript strict mode;
   - linting, formatting, typecheck and test scripts;
   - an accessible responsive shell;
   - private-by-default route structure;
   - placeholder pages matching the approved modules, including Vault Performance;
   - visible data-freshness placeholders for race-, vault- and arena-derived views;
   - CI workflows;
   - `.gitignore` protections for CSVs, database files, secrets and generated private analytics;
   - synthetic fixtures only.
5. Establish test foundations for confirmed game rules, Gold/Blue field invariants, Gold gate eligibility, Open Race star-timing boundaries, freshness behavior and economic-ledger invariants. Do not implement fake analytical recommendations or fake profit figures merely to populate the UI.
6. Prepare deployment configuration for Preview only. Do not require the user to run the project locally and do not activate Production.
7. Update repository documentation with all architecture decisions and unresolved account actions.
8. Run all available validation in the remote development environment.
9. Open a focused draft PR for Phase 0 and clearly state:
   - what changed;
   - architecture selected and why;
   - validation results;
   - privacy protections;
   - Gold/Blue storage, Gold eligibility and no-leakage approach;
   - Open Race pre-entry versus post-lock observation approach;
   - data snapshot/freshness approach;
   - economic-ledger approach;
   - expected costs;
   - review-gate status;
   - exact user actions, if any, required next.

## Autonomous continuation after Phase 0

After Phase 0 is reviewed and the architecture/privacy gate is satisfied, continue through `docs/BUILD_PLAN.md` in order.

Use multiple focused PRs within a phase where necessary. Do not create one enormous PR containing the whole product.

At the start of every phase:

- re-read the relevant source-of-truth documents;
- inspect merged repository truth;
- state the exact phase boundary;
- identify applicable review gates;
- plan testable implementation slices.

At the end of every phase:

- update documentation and the decision log;
- run lint, typecheck, unit, integration and relevant end-to-end tests;
- record limitations and deferred work;
- verify Production remains unchanged;
- open a clear PR or set of focused PRs.

## Non-negotiable product rules

The following are especially important and must not be lost during implementation:

- The product is private and single-user.
- Real CSVs, economic records and private derived data must never be committed to Git. Preserve all analytically relevant source fields inside the approved private raw-data and processing boundary; privacy controls must not compromise analysis quality.
- Bike, car and horse are modelled separately.
- Ignore the obsolete race-class column.
- Race time and speed by mode and exact distance are primary performance evidence.
- Lower elapsed time is better; higher speed is better; normalized UI scores must be higher-is-better.
- Finishing positions have reduced weight during discovery and may receive more weight in paid qualification contexts.
- Do not assume payout format changes intrinsic performance unless holdout data demonstrates it.
- Ten races for a core × mode × exact distance is the minimum minimally analytical sample.
- Discovery must be targeted using the confirmed lineage priority and must allow small controlled probes for unexpected elite outliers.
- Do not calculate remaining lifetime race counts.
- Preserve the source fields `gold_star` and `blue_star`. The visible Yellow star is stored as `gold_star`; Blue remains the first-place signal.
- Yellow/source-Gold indicates the game’s strongest assessed top-three chance in the entered field; Blue indicates the strongest assessed first-place chance.
- Gold stars do not exist in races with three gates or fewer. Those races are Gold-ineligible and must never count as negative Gold evidence.
- Stars are pre-race, field-relative signals. They support but do not replace time/speed analysis.
- A star over strong historical opponents is positive evidence; repeated no-available-star results against weak eligible fields are negative supporting evidence, never an automatic stop or burn rule.
- Raw star assignment and conversion against weak or unknown fields receive no positive ranking weight. Only opponent-adjusted evidence known before the race may support elite-racer, esports, Discovery or direct-racer breeding analysis.
- Distinguish false from missing star data, record Gold eligibility and identify the rate denominator.
- Historical field quality for a star must use pre-event information only; no current-event result or future leakage.
- Test whether the hidden star algorithm changes over time.
- In the Open Race tool, current-race stars are unavailable while the field is forming and must not be requested or used to choose a core.
- The game reveals current Gold/Blue stars only after all gates are filled and the race is set to run, when the entry is already committed.
- Optional post-lock star capture is observation-only. Do not recommend switching cores after lock.
- Keep manual post-lock observations separate from permanent imported history until reconciled idempotently with a later Race Merge import.
- Race data is imported approximately every few days and is not live.
- Display `Data current through`, `Last imported`, data age and freshness status.
- Never present imported opponents, races, stars, arena listings or tournament state as live.
- Tournament qualification rules must be configurable by the user.
- The 50% gate rule is a cap, not a target. The user prefers other users to fill the remaining gates.
- Later tournament rounds and finals are auto-run; optimise the qualification stage.
- ME is a one-use strategic opportunity. Preserve it for the strongest credible Bike, Car or Horse Maiden rather than the first available event.
- Entering one Maiden qualification race commits the core; ME is removed when that event concludes.
- A core may target only one shared Maiden bracket and still be recommended.
- Use the latest imported arena data for external breeding options, display freshness and assume active owned cores are available unless marked otherwise.
- Breeding is probabilistic. Investigate predictive associations but never claim a guaranteed secret formula.
- Test whether parent/lineage star profiles add holdout predictive lift; do not assume stars are inherited.
- Keep elite-upside, vault-gap and balanced breeding rankings separate.
- Never hide a high-upside pairing merely because the vault already has similar coverage.
- Genesis cores cannot be burned. Do not predict burn-credit value.
- The user may manually record the actual BGC received from a burn.
- BGC is a separate non-cash in-game credit and must not be silently included in cash/crypto profit.
- Arena listings do not prove completed breeding income.
- Support manually recorded game-owner tournament payouts sent directly to crypto wallets.
- Keep unlike assets/currencies separate unless an explicit dated conversion is supplied.
- Exclude deposits, withdrawals and internal transfers from operating P/L.
- Do not claim complete lifetime profit where source history or core cost basis is incomplete.
- Never request or store crypto private keys, seed phrases or signing credentials.

## Quality standard

The website must produce explainable, auditable recommendations and financial reporting rather than opaque scores or unverifiable totals. Every recommendation must expose evidence, sample size, confidence, uncertainty and strategic rationale. Star-derived conclusions must expose counts, denominator, Gold eligibility, field context, time agreement, data coverage and freshness. Open Race outputs must distinguish pre-entry recommendations from post-lock observations. Every performance report must expose source coverage, currency/asset scope, classification status and incomplete-data warnings.

Chronological holdout validation is mandatory before recommendations are represented as dependable. Prevent leakage rigorously.

Do not use synthetic results to claim real predictive success. Do not invent official DNA Racing rules. Store inferred payout rules and analytical findings with confidence and allow manual correction.

Begin now with the Phase 0 repository-truth inspection and architecture proposal, then implement Phase 0 in focused reviewable work.

---
