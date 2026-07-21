# AGENTS.md

## Mission

Build and maintain **DNA Racing Intelligence**, a private single-user decision-support platform for the repository owner’s DNA Racing vault.

The platform must turn uploaded historical race, core, vault and arena exports plus user-entered tournament rules and economic transactions into defensible recommendations and reporting for:

- tournament qualification;
- Maiden Eligible strategy;
- mode and distance discovery;
- vault performance and profit/loss analysis;
- breeding and arena partner selection;
- open-race selection; and
- retain, breed, sell or burn decisions.

The product must improve decisions without presenting uncertain inferences as known game mechanics, periodic imports as live data or incomplete cashflow as complete lifetime profit.

## Source of truth order

When sources conflict, use this order:

1. The repository owner’s explicit written clarification in `docs/GAME_RULES.md`, `docs/STAR_SIGNAL_SPECIFICATION.md`, `docs/VAULT_PERFORMANCE_ACCOUNTING.md` and `docs/DECISION_LOG.md`.
2. Current uploaded exports and observable historical data.
3. Official DNA Racing documentation or screenshots recorded in the repository.
4. Modelled or inferred rules, which must be labelled with confidence.

Never silently replace an owner-confirmed rule with an internet source or a statistical inference.

## Mandatory reading before work

Before changing code or data models, read:

- `docs/MASTER_SPECIFICATION.md`
- `docs/GAME_RULES.md`
- `docs/STAR_SIGNAL_SPECIFICATION.md`
- `docs/ANALYTICS_METHOD.md`
- `docs/DATA_CONTRACT.md`
- `docs/VAULT_PERFORMANCE_ACCOUNTING.md`
- `docs/BUILD_PLAN.md`
- `docs/REVIEW_GATES.md`
- `docs/DEFINITION_OF_DONE.md`
- `docs/DECISION_LOG.md`

## Delivery mode

- Work online through GitHub and hosted services.
- Do not require the user to install, build or run the project locally.
- Use focused branches and pull requests.
- Keep each PR narrow enough to review and validate.
- Continue autonomously through the approved phases unless a review gate, account action, secret, paid service, irreversible migration, production activation or unresolved game-rule ambiguity blocks progress.
- Do not merge PRs or activate Production without explicit authority unless the user has subsequently provided a standing instruction permitting it.
- Prefer free tiers and low-cost architecture.

## Product boundaries

- Private, single-user product.
- No public rankings, public API or social features.
- Search-engine indexing disabled.
- Raw exports, processed data, economic records and recommendations are confidential.
- Do not commit private CSV exports, database dumps, credentials or generated personal vault data to Git.
- Use synthetic fixtures for tests.
- Do not scrape authenticated game pages or bypass access controls.
- Tournament and open-race parameters are manually entered until an approved supported integration exists.
- Race, vault, core and arena data are periodically imported snapshots, not live game data.
- Never describe imported opponents, listings, stars or recommendations as live unless a future approved live integration exists.
- Never request or store crypto private keys, seed phrases or signing credentials.
- The website records and analyses transactions but does not initiate wallet, blockchain or game transactions.

## Analytical integrity

- Ignore the legacy race `class` field.
- Analyse bike, car and horse separately.
- Primary performance evidence is race time and speed by mode and exact distance.
- For elapsed time, lower is better. For speed, higher is better. User-facing scores must have a consistent “higher is better” direction.
- Finishing positions are secondary during discovery because fields may contain misallocated or experimental cores.
- In paid qualification contexts, finishing and in-the-money evidence may receive more weight.
- Do not assume payout format changes intrinsic core performance. Test it from data before introducing format-specific ability effects.
- Ten races for a core × mode × exact distance is the minimum threshold for a minimally analytical sample, not proof.
- Use historical data only for lineage predictions.
- Report sample sizes, uncertainty, recency and confidence.
- Use chronological holdout backtesting. Do not leak future results into training features.
- Never claim the secret breeding formula has been discovered unless independently validated to an exceptional standard. Report associations and predictive lift instead.

### Gold and Blue star signals

- Preserve the source `gold_star` and `blue_star` race-entry values using the same user-facing terms: **Gold star** and **Blue star**.
- Gold means the game assessed that core as having the strongest chance to finish in the top three in that entered field.
- Blue means the game assessed that core as having the strongest chance to win and finish first in that entered field.
- Gold stars are not assigned in races with three gates or fewer.
- Derive `gold_star_eligible = gate_count > 3` unless a later owner-confirmed rule changes it.
- Never count a 1-, 2- or 3-gate race as negative Gold-star evidence or include it in a Gold assignment-opportunity denominator.
- A source Gold star in a race with three gates or fewer must be preserved and flagged as an anomaly.
- Stars are pre-race, field-relative signals and are not guarantees or absolute ratings.
- Receiving a star over historically strong cores is positive supporting evidence. Repeatedly receiving no available star against weak cores is negative supporting evidence.
- A missing star, a Gold-ineligible race or a no-star result must never become an automatic stop, burn or poor-core decision by itself.
- Direct race time and speed remain primary. Star evidence supports Discovery, whole-core analysis, Maiden and tournament suitability, breeding research and lifecycle decisions.
- Calculate historical field quality using only information available before the event. Never use the event outcome or later races to assess how impressive that event’s star assignment was.
- Distinguish `false` from missing or invalid source values, track eligibility and whether each star type was assigned in the event, and state all denominators.
- Test for changes in star-assignment frequency and predictive value over time rather than assuming the hidden game algorithm is stable.

### Data freshness

- Race exports are expected approximately every few days, not continuously.
- Store both import time and latest accepted event time.
- Display `Data current through` and `Last imported` separately.
- Display data age and a configurable freshness state.
- Treat imported data as a historical snapshot.
- Do not infer that races after the latest imported event did not occur.
- Recompute affected aggregates idempotently after each accepted cumulative import.

## Economic and accounting integrity

- Keep every asset/currency separate unless an explicit dated conversion rate is supplied.
- Treat BGC as a separate non-cash in-game credit by default, not as cash or crypto profit.
- Track BGC earned, spent and net movement independently.
- Do not infer completed breeding income from an arena listing.
- Do not infer complete wallet balances from race activity alone.
- Exclude deposits, withdrawals and internal transfers from operating P/L.
- Keep realised operating cashflow separate from any future estimated value of unsold cores.
- Use exact decimal or integer minor-unit storage; never binary floating point for money or token amounts.
- Preserve source provenance and manual correction history.
- Prevent cumulative race imports and manual payouts from double counting.
- Manual game-owner tournament payouts must be supported and clearly linked to tournaments without forcing artificial per-core allocation.
- Reports must state coverage, missing cost basis, unclassified activity and whether results are complete, partial or estimated.

## Recommendation principles

### Tournament qualification

- Focus on the user-controlled qualification stage.
- Later rounds and finals are auto-run and may be modelled for suitability but not managed as manual entries.
- The user can attempt to qualify many cores.
- A vault may occupy no more than 50% of race gates, but this is a cap, not a target.
- Do not advise filling 50% merely because it is allowed.
- Recommend candidate cores, intended leaderboard, initial race allocation and stop/continue rules; the user manages live gate occupancy.
- Use historical star evidence as supporting rationale where validated, but continue to rank against the configured qualification metric.
- Make clear that recommendations reflect the latest imported data, not the current live qualification field.

### Maiden Eligible

- Treat ME as a valuable one-use strategic opportunity.
- A core that enters at least one Maiden qualification race is committed to that Maiden and loses ME when that event concludes.
- A non-participating ME core retains ME.
- Compare bike, car and horse potential and preserve ME for the strongest credible mode-specific Maiden.
- A core may target only one of several shared Maiden leaderboards and still be recommended.
- Historical stars over strong fields may strengthen a limited-sample ME case, but must not override materially weak time evidence.

### Discovery

- Do not test modes and distances randomly.
- Prioritise the core’s own history, then parents, grandparents, full siblings, half siblings, offspring, wider lineage and broad population patterns.
- Permit small controlled probes for unexpected elite outlier performance.
- Stop weak hypotheses early where justified.
- Do not calculate remaining lifetime race allowance; the exports do not reliably identify all non-counting tournament races.
- Use early Gold/Blue stars, Gold eligibility, field strength and the quality of the core receiving the star instead as supporting Discovery evidence.

### Breeding

- Provide separate rankings for:
  1. highest offspring quality/upside;
  2. best vault-gap improvement; and
  3. best balanced pairing.
- Existing vault saturation may reduce diversification value but must not suppress a pairing with exceptional estimated offspring potential.
- Use active arena listings from the latest import for external cores and display listing freshness.
- Assume all active owned cores are breeding-available unless manually marked otherwise.
- Respect family restrictions, sex, breed cycles, lifetime splice caps, class matrix, F-number addition and lower-element inheritance.
- Test whether parent and lineage star profiles add chronological predictive lift beyond time-only breeding baselines; do not assume inheritance.

### Burn decisions

- Genesis cores cannot be burned.
- Do not predict burn-credit value.
- Protect unresolved ME, discovery, racing, lineage and breeding value before recommending burn.
- Allow the user to record the actual BGC credit received after a burn for accounting purposes.
- No-star evidence alone is never sufficient to recommend a burn.

## Engineering requirements

- Use TypeScript strict mode.
- Keep analytics deterministic and testable.
- Separate ingestion, domain rules, statistical features, recommendation logic, economic ledger logic and UI.
- Version game rules, inferred payout rules and detected star-algorithm eras by effective date.
- Make imports idempotent and auditable.
- Use database transactions for imports.
- Preserve original source values where practical and store normalized equivalents separately.
- Record import provenance and validation warnings.
- Store Gold and Blue stars as nullable race-entry attributes, store Gold eligibility and validate event-level assignment anomalies.
- Store import timestamp, latest accepted event timestamp and freshness status inputs.
- Add tests for every confirmed game rule and important analytical or accounting transformation.
- Avoid per-request processing of multi-million-row raw datasets; precompute aggregates or use an appropriate analytical pipeline.

## Change-control rules

Stop and request direction before:

- making an irreversible production migration;
- exposing the app publicly;
- adding a paid dependency or service above a trivial cost;
- adding secrets or account integrations the user has not approved;
- changing an owner-confirmed game rule;
- deleting imported source data;
- auto-entering races or making game or wallet transactions;
- presenting an inferred rule as official;
- silently valuing BGC or unsold cores as cash; or
- materially changing the approved architecture.

When blocked, document the exact blocker, safe options and recommended next action.
