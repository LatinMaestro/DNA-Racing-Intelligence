# Independent race probabilities, Core grades and star prediction

Status: owner-requested development programme, 17 October 2026 (Brisbane).
This is an implementation plan, not a claim that a calibrated model, FairEx
adapter, historical replay or entry bot is implemented or commissioned.

## Authority and delivery priority

The owner requests our own explainable Core/competitor grades, win/place
probabilities and Blue/Yellow star predictions for historical races and Open
Race candidate selection, with continuing evaluation against actual results.
FairEx is an optional independent comparator, never our calculation authority.

Follow AGENTS.md, the analytical method authority matrix, Issue #120's latest
amendments, ANALYTICS_METHOD.md, STAR_SIGNAL_SPECIFICATION.md,
OPEN_RACE_WORKFLOW.md and the existing tournament probability/economic method.
Preserve Bike/Car/Horse, exact distance, competition/format/gate/element context,
sample rules, historical validation, breeding and economic methods. Do not
invent coefficients, grade boundaries, sparse-sample assumptions or a new
ranking simply to populate a screen. Material new assumptions need evidence
and recorded owner approval through the existing method controls.

The active **DNA API Delivery** scheduled prompt owns delivery. Continue
commissioning-critical dependencies first, with one active delivery PR. Then
execute the next dependency-ready slice below, reusing existing domain methods,
services, components and compact read models. This work must progress through
implementation, not repeated research-only handoffs. FairEx access and complete
archive coverage must not become initial-commissioning dependencies. Provider
restrictions block connected acceptance, not safe offline development.

Owner direction and research traceability in Issue #120:

- [Verified simulator/FairEx review](https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6230631648)
- [Post-fill timing and selected betting coverage](https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6230716906)
- [Independent calculator and improvement loop](https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6230785193)

## Existing foundation and known gaps

Reuse `domain/core-performance.ts` and accepted historical time/speed evidence;
`domain/star-signals.ts` and approved opponent-quality semantics;
`domain/open-race-eligibility.ts`, `domain/open-race-pre-entry-ranking.ts` and
the existing version-bound field-lock/workspace services. The current Open Race
rank is a provisional time comparison, not a calibrated probability generator.
`domain/private-chronological-validation.ts` assesses supplied validation
metrics; it does not fit or generate a probability model. Existing tournament
ranking likewise does not implement the full owner-approved probability/EV
method. Extend accepted methods rather than creating competing formulas.

### Bounded accepted-history retrieval prerequisite

Migration `0141` and `readSelectedCoreRows` in
`lib/neon-active-dna-core-race-history-generation.ts` provide an indexed,
owner-isolated read of existing compact results for a pinned generation/digest
and 1–64 explicit Core IDs. The caller sets a 1–10,000 row ceiling; one extra
sentinel row detects overflow and no partial sample is returned. The adapter
checks least privilege, generation identity, ordered row identity and checksums
inside a read-only transaction with a statement timeout. Legacy copied Race
payloads are withheld. No Race metadata, ranking or mathematical rule is added.

This is a retrieval prerequisite, not a complete exact-context reader or
commissioned prediction. The next adapter must join the existing immutable
canonical Race authority, verify mode/distance/competition/format/gates/element,
cutoff and accepted aggregate/coverage bindings, and use the existing
`OpenRaceAcceptedHistoryReadBoundary` source-drift check. Missing authority must
stay unavailable. Apply the index/function migration to Preview only after the
existing cost, migration and lock-safety gates; fixture/CI validation alone does
not authorise connected acceptance or claim that the migration is deployed.

The selected-result composition in `lib/selected-core-history-race-source.ts`
now joins exact immutable Race receipts in sequential batches of at most 20,
with a caller-supplied unique-document budget checked before any object read.
It verifies receipt hash/time, Race/Core membership, exact observable
mode/distance/gates/format/event time, excludes events at or after the cutoff,
and withholds the entire response on generation drift or invalid evidence.
Competition and element remain explicitly unknown: current Core metadata and
missing tags cannot establish historical classification. The service always
returns `analyticalUseAllowed: false` and `exactContextVerified: false`.
Accepted competition/element classification and aggregate/population coverage
binding remain required before composing the complete
`OpenRaceAcceptedHistoryReadBoundary`. No provider client, UI activation,
probability formula or source publication is created by this join.

`lib/accepted-historical-race-context-authority.ts` now validates a bounded
owner-scoped read from an immutable published competition/element context
repository. It requires the active history generation, observation digest and
historical aggregate version to agree before and after the read; verifies every
stored row digest; rejects truncation, cross-owner access and publication
drift; and preserves explicit `known`, `not_applicable` and `unknown` element
states. It performs no tag parsing or classification inference. A persisted
repository/publication implementation and connected Preview acceptance remain
required before this authority can make historical probability evidence
available.

## Dependency-ordered implementation slices

| Slice                                           | Concrete development task                                                                                                                                                                                                            | Acceptance / dependency                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Independent baseline                         | Trace approved pairwise/bootstrapped time-distribution mathematics to current code and tests; identify only missing method decisions, then implement the smallest supported deterministic baseline with synthetic fixtures.          | All comparable valid outcomes, exact context, sample/uncertainty disclosure, reproducibility and explicit unavailable states. Unresolved distribution/tie/grade assumptions remain review-required. No fabricated calibration claim.                                                                                                     |
| 2. Frozen predictions and result reconciliation | Reuse existing source/version contracts to retain prediction time, field identity, feature cutoff, model version, target and evidence status. Reconcile accepted Open Lab race results and stars idempotently by race/Core identity. | Freeze the entire event before updating any history from it. Corrections retain provenance; missing/partial targets remain unscored. Persist privately only through approved boundaries.                                                                                                                                                 |
| 3. Historical evaluation                        | Implement chronological training/calibration/holdout separation and compare the independent baseline with simple approved baselines. Retain immutable predictions and per-context coverage.                                          | Calibration/Brier and relevant finish/star accuracy, uncertainty, sample depth and era checks. Current-history replay of an old race is labelled retrospective what-if, not a point-in-time backtest.                                                                                                                                    |
| 4. Core grades and race UI                      | Extend Core Intelligence/Search and Open Race with auditable performance grades, separate confidence, win/place distributions, sample/freshness context and historical actual results.                                               | Grade meaning, benchmark population and mapping are method-reviewed/versioned; unsupported Cores remain unrated. Higher-is-better display direction. Official standings stay separate. No substituted distance or invented PWR/VAR.                                                                                                      |
| 5. Open Race candidate scenarios                | Hard-filter eligibility, then evaluate each owned candidate individually against already entered opponents; explain alternatives, unresolved opposition and avoidance.                                                               | Independent model works without FairEx/current stars. Disclose empty gates; exact field/status/fee/restriction/version changes invalidate results. Race-entry EV uses actual same-asset fee and placement payouts, separate from qualification EV.                                                                                       |
| 6. Star prediction                              | Predict game Blue and Yellow/source-Gold assignments as separate targets using approved point-in-time time/opposition/history evidence.                                                                                              | Blue is the game's win signal; Yellow is its top-three signal. Gold is not applicable at <=3 gates. Distinguish predicting a star from predicting a win; win odds alone do not identify top-three probability or hidden star rules. Historical-star ranking weight still requires established opposition and validated incremental lift. |
| 7. Optional FairEx comparator                   | Establish supported read access and a bounded representative coverage pilot; then implement a permitted cached historical adapter if the contract is proven.                                                                         | Separate source-labelled quotes from accepted race facts. Do not bypass restrictions or launch a mass URL scrape. Failure or absence of odds never blocks our independent model.                                                                                                                                                         |
| 8. Controlled improvement                       | Compare a versioned challenger with the last-good champion on untouched chronological holdouts; retain evaluation history, evidence, promotion and rollback records.                                                                 | Promote only after applicable method review, regression and calibration gates. Negative/uncertain lift does not activate a model. Later outcomes may improve future versions, never rewrite frozen forecasts.                                                                                                                            |

Slices may be split into narrow PRs or composed with an existing tightly related
dependency, without mixing unrelated changes. Before opening each PR, recheck
live main, active work and the highest-value remaining commissioning dependency.
Do not create a separate training service, duplicate ingestion pipeline or
general-purpose model platform just to implement this plan.

## FairEx timing, access and interpretation

The owner confirms that betting opens **only after all race gates are filled**.
Target-race FairEx odds cannot be inputs to our pre-entry or final-gate decision.
Use them as a post-lock comparison. A market-informed experimental variant may
use only prior-race information available before its prediction cutoff, with a
separate evaluation of outcome accuracy versus mere market agreement.

Public frontend inspection identified application read calls under
`https://api.dnaracing.run/fairex_races/markets/`: `race` by `rid`, `odds` by
race/market/selected Cores, plus `active` and `bet_types`. This is evidence of an
application interface, not a published supported Open Lab v1 contract. Three
unauthenticated probes returned HTTP 403 in the review environment; the cause
and access entitlement are unresolved. Do not repeat or bypass those probes.

The [RPC page](https://dna.fairex.live/rpc) describes Polygon endpoint selection
and says odds/balances/settled bets use RPC. It does not document the contract
ABI, race-to-market mapping, complete-book historical getter, block/event
semantics, retention or supported bulk access needed for our adapter. The
inspected frontend requests displayed market data through its application API.
Do not assume changing RPC endpoints supplies a historical odds feed. Accepted
bet logs, if available, would not alone prove complete unbet-market coverage.

Prefer supported read API/export access; consider a documented read-only chain
route only if complete quote semantics and safe access are proven. Use accepted
race IDs, complete race books where supported, deduplication/cache and bounded
rate/cost budgets. Retain URLs as drill-through links, not per-request scraping.
Before a backfill, establish reuse permission, coverage, precise odds/selection
identity, quote versus capture timestamps, revisions, settlements and limits.
Keep unavailable, not bettable, unsupported and failed retrieval distinct.

The owner reports low-race-count exclusions; exact thresholds and contexts are
unknown. Normal-Free exclusion is suspected, not confirmed: one reviewed race
labelled free by the fan simulator had FairEx odds. Resolve classification from
accepted source evidence. Bettable races form a selected population; report
coverage by mode/distance/competition/sample/era and do not generalise mature
Core calibration to low-sample or unbettable cohorts without independent tests.

Raw implied probability is the reciprocal of decimal odds. It may sum above
100%; proportional normalisation is a labelled comparison baseline, not the
true game probability or verified margin allocation. FairEx odds are not known
hidden engine probabilities. Betting return (`P(win) * decimal odds`) is not
race-entry EV and must not drive entry selection as though it were.

## Continuous evaluation and completion evidence

The improvement loop is **freeze independent prediction -> attach optional
FairEx comparison -> reconcile accepted Open Lab outcomes/stars -> evaluate ->
test challenger -> gated promotion or retain last-good model**. Continuous
evaluation does not authorise uncontrolled self-modifying weights. Show model
version, evidence cutoff, sample/coverage and calibration status in the UI.

Use synthetic regression fixtures for context isolation, ties/sample boundaries,
missing opponents, chronology and same-event leakage, nullable/false stars,
Gold eligibility, correction/idempotency, odds completeness, field invalidation,
asset-separated economics and version recovery as relevant to each slice.
Require applicable formatting, zero-error lint, strict TypeScript, focused/full
regressions, production build, Worker dry-run, security checks and relevant
migration validation; review exact-head CI and independently verify merged-main
CI. Fixture evidence is not connected/deployed acceptance.

Preserve single-owner Clerk, forced owner RLS, least privilege, private R2
evidence and last-good recovery. No Neon/R2/hosted Preview access while current
capacity restrictions apply; no paid services or Production without explicit
owner approval. Never alter/merge protected PRs #624/#625. The future separately
authorised local final-gate bot may consume validated advisory output and must
revalidate the field before execution; this plan authorises no bot activation,
wallet, betting or game transaction. Keep existing cloud execution prohibitions.
