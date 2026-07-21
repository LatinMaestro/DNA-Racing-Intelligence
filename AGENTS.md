# AGENTS.md

## Mission

Build and maintain **DNA Racing Intelligence**, a private single-user decision-support platform for the repository owner’s DNA Racing vault.

The platform must turn uploaded historical race, core, vault and arena exports plus user-entered tournament rules into defensible recommendations for:

- tournament qualification;
- Maiden Eligible strategy;
- mode and distance discovery;
- vault performance analysis;
- breeding and arena partner selection;
- open-race selection; and
- retain, breed, sell or burn decisions.

The product must improve decisions without presenting uncertain inferences as known game mechanics.

## Source of truth order

When sources conflict, use this order:

1. The repository owner’s explicit written clarification in `docs/GAME_RULES.md` and `docs/DECISION_LOG.md`.
2. Current uploaded exports and observable historical data.
3. Official DNA Racing documentation or screenshots recorded in the repository.
4. Modelled or inferred rules, which must be labelled with confidence.

Never silently replace an owner-confirmed rule with an internet source or a statistical inference.

## Mandatory reading before work

Before changing code or data models, read:

- `docs/MASTER_SPECIFICATION.md`
- `docs/GAME_RULES.md`
- `docs/ANALYTICS_METHOD.md`
- `docs/DATA_CONTRACT.md`
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
- Raw exports, processed data and recommendations are confidential.
- Do not commit private CSV exports, database dumps, credentials or generated personal vault data to Git.
- Use synthetic fixtures for tests.
- Do not scrape authenticated game pages or bypass access controls.
- Tournament and open-race parameters are manually entered until an approved supported integration exists.

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

## Recommendation principles

### Tournament qualification

- Focus on the user-controlled qualification stage.
- Later rounds and finals are auto-run and may be modelled for suitability but not managed as manual entries.
- The user can attempt to qualify many cores.
- A vault may occupy no more than 50% of race gates, but this is a cap, not a target.
- Do not advise filling 50% merely because it is allowed.
- Recommend candidate cores, intended leaderboard, initial race allocation and stop/continue rules; the user manages live gate occupancy.

### Maiden Eligible

- Treat ME as a valuable one-use strategic opportunity.
- A core that enters at least one Maiden qualification race is committed to that Maiden and loses ME when that event concludes.
- A non-participating ME core retains ME.
- Compare bike, car and horse potential and preserve ME for the strongest credible mode-specific Maiden.
- A core may target only one of several shared Maiden leaderboards and still be recommended.

### Discovery

- Do not test modes and distances randomly.
- Prioritise the core’s own history, then parents, grandparents, full siblings, half siblings, offspring, wider lineage and broad population patterns.
- Permit small controlled probes for unexpected elite outlier performance.
- Stop weak hypotheses early where justified.
- Do not calculate remaining lifetime race allowance; the exports do not reliably identify all non-counting tournament races.

### Breeding

- Provide separate rankings for:
  1. highest offspring quality/upside;
  2. best vault-gap improvement; and
  3. best balanced pairing.
- Existing vault saturation may reduce diversification value but must not suppress a pairing with exceptional estimated offspring potential.
- Use active arena listings for external cores.
- Assume all active owned cores are breeding-available unless manually marked otherwise.
- Respect family restrictions, sex, breed cycles, lifetime splice caps, class matrix, F-number addition and lower-element inheritance.

### Burn decisions

- Genesis cores cannot be burned.
- Do not estimate burn credits.
- Protect unresolved ME, discovery, racing, lineage and breeding value before recommending burn.

## Engineering requirements

- Use TypeScript strict mode.
- Keep analytics deterministic and testable.
- Separate ingestion, domain rules, statistical features, recommendation logic and UI.
- Version game rules and inferred payout rules by effective date.
- Make imports idempotent and auditable.
- Use database transactions for imports.
- Preserve original source values where practical and store normalized equivalents separately.
- Record import provenance and validation warnings.
- Add tests for every confirmed game rule and important analytical transformation.
- Avoid per-request processing of multi-million-row raw datasets; precompute aggregates or use an appropriate analytical pipeline.

## Change-control rules

Stop and request direction before:

- making an irreversible production migration;
- exposing the app publicly;
- adding a paid dependency or service above a trivial cost;
- adding secrets or account integrations the user has not approved;
- changing an owner-confirmed game rule;
- deleting imported source data;
- auto-entering races or making game transactions;
- presenting an inferred rule as official; or
- materially changing the approved architecture.

When blocked, document the exact blocker, safe options and recommended next action.
