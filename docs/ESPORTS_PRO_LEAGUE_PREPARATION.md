# DNA Pro League Preparation

Status: **current Pro League preparation authority**  
Effective: **27 August 2026**

## Authority

This document combines:

- the DNA Community Update supplied by the owner on 20 August 2026;
- later owner-provided/confirmed Pro League roster rules that supersede the initial announcement assumptions; and
- the 27 August 2026 API-first architecture decision.

Where current rules below conflict with the older announcement snapshot, the current rules govern validation and recommendations. The older announcement remains recorded later in this document as historical evidence.

## Owner-confirmed performance relationship

Pro League is part of the DNA Racing ecosystem. A Core has the **same underlying stats and performance characteristics** in normal DNA Racing and Pro League.

Therefore accepted DNA Racing historical evidence remains the primary audited performance base for Pro League preparation, including:

- exact-distance times and speed;
- finishing evidence;
- Gold/Blue pre-race star signals;
- race/payout-format evidence;
- mode breadth;
- sample size and recency; and
- lineage/Discovery evidence.

Current DNA Open Lab API fields may add useful current context but do not replace historical performance evidence automatically.

## Current roster rules

My Vault is unlimited. The Pro League roster is a separate constrained selection from that vault.

A legal current roster must satisfy all of the following:

- **12 to 25 Cores** total;
- maximum **10 substitutions per year**;
- maximum **7 Metal**;
- maximum **8 Fire**;
- maximum **10 Earth**;
- maximum **2 Genesis per element**;
- maximum **5 Cores at F5 or below**;
- maximum **12 Cores at F10 or below**;
- minimum **2 Cores above F15**;
- minimum **8 female Cores**; and
- every rostered Core must have a name.

There is no current minimum Water count supplied. Water therefore remains constrained only by the total roster and other applicable rules unless DNA supplies a later rule.

## Initial roster and substitution allowance

Whether the first/initial roster selection consumes any part of the annual maximum-10 substitution allowance is unresolved.

Implementation must therefore:

- represent the initial-roster counting rule explicitly;
- default it to an unresolved/configurable authority state until DNA clarifies;
- never silently consume or preserve substitutions based on an assumption; and
- show the owner which interpretation is currently active when substitution budget is displayed.

## Quality-first roster objective

Do **not** force the roster to 25.

The objective is:

1. construct the strongest rule-compliant nucleus;
2. maintain at least 12 Cores;
3. add additional Cores only when they provide meaningful incremental competitive/structural value; and
4. stop before 25 if extra slots would dilute quality or consume future flexibility without a credible purpose.

A 12-Core roster is legal if every other rule is satisfied. A 25-Core roster is not inherently better.

The website should distinguish:

- nucleus;
- optional value-adding slots;
- alternates/candidates outside the current roster;
- marginal replaceable slots; and
- structural gaps.

## Evidence model

Do not collapse Pro League advice into one opaque universal score.

For each candidate show separate evidence dimensions, including:

- class;
- element;
- sex;
- F-number;
- name/current ownership;
- total historical race sample;
- modes with evidence;
- exact distances with minimally analytical samples;
- winning-range and top-three-range evidence;
- sample sizes and freshness;
- Gold/Blue historical signal evidence;
- payout/race-format coverage;
- current API observations where available;
- Discovery gaps;
- structural roster contribution; and
- confidence/uncertainty.

Candidate ordering may use a transparent deterministic review order but must expose the underlying dimensions.

## Historical performance remains the audited base

Primary Pro League evidence remains historical and chronological:

- Core Performance;
- exact-distance distributions;
- star profiles;
- payout-format profiles;
- sample/recency evidence;
- cross-mode breadth;
- Discovery outcomes; and
- lineage evidence.

Current API state must not leak backward into historical backtests.

## DNA Open Lab API enrichment

Once connected payload authority is proven, current API evidence may include separate dimensions such as:

- power;
- adjusted odds;
- variance;
- current game racing stats;
- stamina;
- equipped assets;
- owner/listing state;
- recent races; and
- current splicing/lineage state.

These observations must be timestamped and displayed as **current context**.

Before any of these fields receive ranking weight, the project should test whether they add predictive lift beyond the existing historical model. A current field must not be blended into one hidden score merely because it is available.

## Roster persistence and audit

Persist:

- roster version;
- effective dates;
- nucleus membership;
- optional slots;
- alternates;
- reason/evidence snapshot per membership decision;
- current compliance result;
- structural gaps;
- substitution ledger; and
- unresolved authority/configuration state.

API ownership can reconcile whether the owner currently holds a Core in the game but must not erase local roster history, notes, ME state, Discovery plans or lifecycle strategy.

## Substitution ledger

Track at minimum:

- year/season boundary used for the allowance;
- substitution number;
- outgoing Core;
- incoming Core;
- effective timestamp;
- reason/evidence snapshot;
- whether the change counts toward the allowance under the active authority interpretation; and
- remaining budget.

The maximum is 10 substitutions per year under current authority.

## Discovery preparation

Pro League should be one of the most Discovery-intensive workflows.

The goal is not to race every Core blindly. Convert roster uncertainty into ranked probes.

Prioritise:

1. candidates that could enter the nucleus;
2. candidates that could replace a marginal roster Core;
3. tests that resolve a structural gap;
4. promising missing modes/adjacent distances for known strong Cores; and
5. lineage-supported hypotheses with credible upside.

Retain the existing minimum of **10 races per Core × mode × exact distance** for a minimally analytical conclusion. Earlier evidence may support continue/stop hypotheses but not fabricate confidence.

Stop weak paths early. Preserve separate Bike/Car/Horse evidence.

## Active-race opportunity matching

DNA Open Lab active-race/fill data may be used to show suitable **manual** racing opportunities for Pro League Discovery.

The website may:

- identify active races matching a target mode/distance/restriction;
- compare current field/owned candidates where supported;
- show which Discovery objective the race could advance; and
- update readiness after the finished result is later synced.

It must never enter a race or submit a game action.

## Breeding acceleration

Breeding objectives should be derived from:

- structural roster gaps;
- performance gaps;
- weak/marginal roster slots;
- uncertain future needs; and
- exceptional-upside opportunities.

Do not breed only to satisfy a numeric quota if the expected candidate quality is poor.

When connected, use official DNA Open Lab Splice evidence:

- current Arena;
- `pair_info` for official baby element/F/type/cost preview; and
- `pair_validate` for current official pair eligibility/validation.

Combine those official current facts with the website's historical lineage/performance/upside research.

The website may rank/shortlist pairs but must not execute a splice or wallet transaction.

## Current-rule structural interpretation

The following constraints are ceilings:

- 7 Metal;
- 8 Fire;
- 10 Earth;
- 2 Genesis per element;
- 5 at F5 or below;
- 12 at F10 or below.

The following are minimums:

- 12 total Cores;
- 2 above F15;
- 8 females.

There is no authority to treat the maximum values as targets. The strongest roster may sit well below one or more ceilings.

## Roster-size rationale

Every recommendation to expand beyond the nucleus should state the incremental reason, for example:

- unique high-level mode/distance strength;
- material coverage of a structural weakness;
- credible all-round breadth;
- substitution-risk hedge;
- strategic specialist value; or
- evidence-backed upside that is not duplicated by the current roster.

"There is space remaining" is not a sufficient reason to add a Core.

## API access loss

Pro League must remain usable if DNA Open Lab access pauses.

On API/tier loss:

- retain last-good roster evidence/read models;
- show current API-derived fields as stale where appropriate;
- continue historical analytics and local roster/substitution strategy normally; and
- resume current-state catch-up when API access returns.

Do not invalidate the roster merely because the newest current-state fields cannot refresh.

## Private `/pro-league` commissioning target

The first owner-usable Pro League page should provide:

- current roster and nucleus;
- alternates;
- compliance validator;
- roster-size rationale;
- evidence dimensions;
- substitution budget/history;
- Discovery queue;
- active-race opportunities;
- breeding queue;
- official pair viability/cost when connected;
- structural gaps;
- marginal slots; and
- sync/freshness/stale-but-usable status.

## Safety and scope

The Pro League workspace is private, owner-only and advisory.

It must not:

- create or submit a team;
- enter races;
- mint;
- trade;
- connect/sign with a wallet;
- execute a splice;
- place bets;
- administer public sponsors/team pages; or
- turn the application into a multi-user/team SaaS product.

## Historical announcement snapshot — superseded roster assumptions

The 20 August 2026 Community Update was initially recorded with the following provisional roster assumptions:

- exactly 25 Cores;
- minimum 5 Metal, 5 Fire, 5 Earth and 5 Water;
- maximum 2 "gens" per element, interpreted provisionally as Genesis;
- minimum 8 females;
- at least 5 F15+ Cores; and
- current announced focus on Bike.

The announcement also described 12 Pro teams, an open-entry lower league with promotion/relegation, two Pro matches per week, best-of-three maps and first-to-16 map scoring, and referenced live betting markets.

These statements remain historical evidence of the earlier announcement. **They do not control current roster validation where they conflict with the current rules above.** In particular, exactly-25, minimum-five-per-element and minimum-five-F15+ assumptions are superseded.

Competition-format statements not contradicted by later authority remain provisional context until DNA publishes/clarifies the final rulebook.
