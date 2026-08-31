# DNA Pro League Preparation

Status: **current Pro League preparation authority**  
Effective: **29 August 2026**

## Authority

This document combines:

- the DNA Community Update supplied by the owner on 20 August 2026;
- later owner-provided/confirmed Pro League roster rules that supersede the initial announcement assumptions; and
- the public DNA Esports trial pages and owner-supplied trial announcements reviewed on 29 August 2026; and
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
- at least **32% female Cores, rounded up** (4 for a 12-Core roster and 8 for a 25-Core roster); and
- every rostered Core must have a name.

There is no current minimum Water count supplied. Water therefore remains constrained only by the total roster and other applicable rules unless DNA supplies a later rule.

The live trial team page observed on 29 August displayed a female minimum of
32% of roster size, rounded up. The owner confirmed on 29 August that this is
the current validation rule: 4 females for a 12-Core roster and 8 for a full
25-Core roster. It replaces the earlier fixed minimum-eight interpretation.

## Initial roster and substitution allowance

Whether the first/initial roster selection consumes any part of the annual maximum-10 substitution allowance is unresolved.

Implementation must therefore:

- represent the initial-roster counting rule explicitly;
- default it to an unresolved/configurable authority state until DNA clarifies;
- never silently consume or preserve substitutions based on an assumption; and
- show the owner which interpretation is currently active when substitution budget is displayed.

## Team registration and map setup

The current owner-confirmed setup sequence is:

1. create the team manually at `https://esports.dnaracing.run/teams`;
2. set a 12–25 Core roster manually;
3. open `https://esports.dnaracing.run/maps`, choose a map and scroll to its ordered race list;
4. use the DNA Esports Set control to assign a rostered Core either to one race line or to every line on that map with the same race type and exact distance; and
5. after a match is scheduled, return to the team match-history control and
   complete the match-specific map actions manually: the home Vault picks map
   1 and denies one map, then the away Vault picks map 2 from the two maps left
   by that action; and
6. confirm the match-specific third-map result before lock.

The private website may recommend, stage and validate this work. It must not create the team, submit the roster, click Set, submit a race-line mapping or choose a match map.

## Head-to-head matchup authority

Current owner-confirmed authority is:

- every Pro League match is between two Vaults;
- every race field is split equally between them;
- each Vault preselects mapped Bike Cores from its registered 12–25 Core roster;
- the home Vault has the first map pick and one denial;
- the away Vault has the second map pick from the two maps left after the home action;
- the third-map resolution must be read from the actual match ruleset; and
- the website remains advisory and never submits the home choice or lineup.

The matchup planner must accept an opposition Vault, compare both rosters at
the exact Bike race type and distance, and classify each race line as favoured,
contested, unfavourable or unknown. It must rank the home first-pick and denial
options, then rank the away second-pick options remaining after the home action.
Incomplete opponent evidence is unknown, never a free advantage.

Two live trial match-page wordings conflict on the third map. One says the
denied map never returns and the sole remaining map is map 3. Another says the
denied map returned to a two-map random pool under the rule in force for that
match. The private website must support both policies as explicit, versioned
match authority. It must never infer one global rule from a trial page.

## Published map authority

The public Maps and live match pages reviewed through 29 August 2026 state:

- a match is best-of-three maps;
- each map is a fixed sequence of 42 races that does not change;
- the first team to 16 race points wins the map and must win by two;
- races after line 16 are reached only while the score remains close enough; and
- four maps are currently published.

| Map | Name     | Composition                                                          | First 16 avg | All 42 avg |
| --: | -------- | -------------------------------------------------------------------- | -----------: | ---------: |
|   1 | Anchor   | 21 × 6-gate Madness, 19 × 1v1, 2 × 12-gate WTA                       |       1488 m |     1586 m |
|   2 | Glory    | 11 × 4-gate WTA, 11 × 6-gate WTA, 10 × 16-gate WTA, 10 × 24-gate WTA |       1600 m |     1586 m |
|   3 | Measure  | six race types, seven lines each                                     |       1600 m |     1610 m |
|   4 | Miracles | 21 × 22-gate WTA, 21 × 24-gate Madness                               |       1688 m |     1610 m |

All four maps use the seven published distances from 1000 m to 2200 m. The
domain catalogue preserves every exact race line and its order; aggregate
summaries are not a substitute for that catalogue. No additional map is
currently configured or assumed.

Trial organizer guidance described Anchor as favourable to smaller Vaults with
a few strong Cores, Glory as the all-WTA variance map, Measure as the rounded
depth map and Miracles as the widest/deepest Vault test. Preserve those notes
as organizer guidance only. They are not predictive field authority and cannot
override exact-format, exact-distance performance evidence.

## Trial match lifecycle and scoring observations

The reviewed public trial exposed these operating states and boundaries:

- schedules are normally posted about one day before the match;
- practice days are represented as Week tabs (for example Week 0 and Week 1);
- map lineups are saved across matches, should be configured for all four maps
  and may be edited until the relevant match locks;
- the team UI prevents roster/team edits while a match is underway;
- match cards progress through scheduled/awaiting-pick, maps-set, locked, live
  and finished states;
- a map stops as soon as one side has at least 16 race points and a two-point
  lead; a 16–16 map continues;
- a best-of-three match stops as soon as one side wins two maps, so map 3 is
  not raced after a 2–0 result; and
- each layer remains separate: a Core result, the team race-point winner, map
  score, match result and league-table points are not interchangeable facts.

If all 42 catalogue races are exhausted without a two-point lead, the observed
sources do not establish the final resolution. Keep that state unresolved
rather than inventing overtime or a tiebreak.

The trial standings page currently awards 3 league points for a win, 1 for a
draw and 0 for a loss, with displayed tie-break order: league points, event
wins, race-point differential, then race points won. Pro and lower-league
standings are distinct competition views. These remain versioned trial/live
site observations until the proper season rulebook is fixed.

Trial payouts, unlimited roster edits and disabled ageing are practice-event
exceptions. They are not permanent league economics or roster rules. Missed
home-pick fallback wording is also provisional: record an actual automated or
administrator-selected map as match evidence, but do not predict the fallback.

## Mapping-planner contract

For every staged assignment retain:

- map identity and catalogue version;
- source race number;
- exact race type and distance;
- rostered Core ID;
- assignment scope: `single_race` or `same_type_and_distance`; and
- every race line affected by the expansion.

The planner must reject unknown maps/races, non-roster Cores and conflicting assignments. It must report both total map coverage and first-16 coverage. Applying `same_type_and_distance` is scoped to the selected map; it never silently changes another map.

Persist each complete four-map lineup as reusable local strategy state. A
match references the saved lineup version in force at lock; later edits must
not rewrite the historical locked matchup. Also retain home pick, home denial,
away pick, third-map policy/result, lock time and whether an administrator or
deadline fallback supplied any choice.

It must also show the equal gate allocation for every race line, compare our
mapped Core with the opposing Vault's selected or best-supported likely Core,
and rank the role-eligible map choices by favourable, contested, unfavourable
and unknown exact-format lines.

## Ageing-aware 25-Core owner strategy

A 12-Core roster remains legal, but the current owner strategy is to register
all **25** available places. Registration itself is age-neutral: ageing is
incurred only when a Core actually runs a mapped Pro League race.

Fill the roster with:

1. proven exact-format/exact-distance Pro League specialists;
2. credible rotation or developing Cores that can add competitive depth; and
3. structural or exact-line coverage specialists.

Do not use an empty slot as ageing protection. Instead, protect the Vault's
irreplaceable normal-tournament Cores by excluding them from the Pro League
roster by default. A protected tournament Core may be included only as an
explicit high-importance contingency when its expected map impact clearly
justifies spending its ageing. Registration is not permission to map or race a
Core.

The website must track mapped starts and ageing exposure separately from
roster membership, spread justified starts across real depth, and preserve
normal-tournament capacity. Exact ageing increments and exclusion thresholds
remain unresolved until authoritative values are available; do not invent a
numeric cutoff.

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
- Yellow/source-Gold and Blue historical signal evidence, including
  opposition-quality coverage, strong-field assignments and elite-opponent
  assignments;
- payout/race-format coverage;
- current API observations where available;
- Discovery gaps;
- structural roster contribution; and
- confidence/uncertainty.

Candidate ordering may use a transparent deterministic review order but must expose the underlying dimensions.

Raw star totals and raw conversion never improve esports ranking. Only
opposition-adjusted star evidence known before the race may break an otherwise
tied intrinsic exact-format/distance comparison. A perfect record over weak or
unknown fields is descriptive only; a star over a pre-race elite opponent is
positive supporting evidence. Exact-format time, speed and consistency remain
primary.

## API-only evidence hierarchy

Historical and chronological performance remains the preferred analytical evidence when an authoritative API contract supplies it:

- Core Performance;
- exact-distance distributions;
- star profiles;
- payout-format profiles;
- sample/recency evidence;
- Bike exact-distance breadth;
- Discovery outcomes; and
- lineage evidence.

The observed API does not currently expose direct elapsed time, finishing position or explicit distance in finished/document race shapes. Until that changes, the first API-only Pro League commissioning must:

- prioritize structural roster compliance and owner strategy state;
- present current API observations as separate timestamped dimensions;
- label historical time/distance, star and outcome-dependent advice unavailable where the API cannot support it;
- avoid claiming the strongest historical-performance roster from incomplete evidence; and
- never reactivate CSV implicitly.

Current API state must not leak backward into historical backtests if historical observations become available later.

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

## Discovery relationship

Pro League is not a Discovery programme for a properly assessed Core. Mapping
must be competitively justified, not an excuse to accumulate a sample.

For credible developing or under-evidenced roster Cores, races run for a real
competitive role may incidentally add useful evidence. Treat that evidence as
a secondary benefit and keep it in the same point-in-time, exact-format and
exact-distance evidence model. Complete deliberate Discovery through the
normal mode-aware Discovery workflow.

Before roster lock, convert remaining uncertainty into ranked normal-racing
probes rather than spending Pro League ageing blindly.

Prioritise:

1. candidates that could enter the nucleus;
2. candidates that could replace a marginal roster Core;
3. tests that resolve a structural gap;
4. promising missing/adjacent Bike distances for known strong Cores; and
5. lineage-supported hypotheses with credible upside.

Retain the existing minimum of **10 races per Core × mode × exact distance** for a minimally analytical conclusion. Earlier evidence may support continue/stop hypotheses but not fabricate confidence.

Stop weak paths early. Use Bike evidence only for Pro League. Preserve separate
Car and Horse evidence for non-Pro-League workflows without allowing it to
affect Pro League ranking or mapping.

## Active-race opportunity matching

DNA Open Lab active-race/fill data may be used to show suitable **manual**
normal-racing opportunities for pre-roster Discovery.

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

Coverage-gap analysis must enumerate every published exact Bike
race-type-plus-distance demand and distinguish winning-range coverage,
competitive/top-three coverage, the best currently available Core where that
Core is still weak, and unproven demands.

For a weak best-available Core, say so plainly. Recommend efficient Discovery
of other credible owned Cores or evidence-backed breeding before roster lock.
If a weak Core is unavoidable for structural compliance, mark it provisional,
explain the gap it covers and place it on the replacement-priority list. The
annual 10-substitution limit makes initial specialist quality and replacement
preservation critical even though the owner strategy fills all 25 age-neutral
registration places.

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

- unique high-level Bike distance strength;
- material coverage of a structural weakness;
- credible Bike distance breadth;
- substitution-risk hedge;
- strategic specialist value; or
- evidence-backed upside that is not duplicated by the current roster.

"There is space remaining" is not a sufficient reason to add a Core.

## API access loss

Pro League must remain usable if DNA Open Lab access pauses.

On API/tier loss:

- retain last-good roster evidence/read models;
- show current API-derived fields as stale where appropriate;
- continue retained last-good analytics and local roster/substitution strategy normally; and
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
- marginal slots;
- published map definitions, first-16 coverage and staged race-line mappings; and
- opposition selector and evidence freshness;
- home first-pick/denial ranking, away second-pick ranking and third-map contingency;
- head-to-head race-line recommendations and equal gate allocation;
- exact format/distance weakness report with Discovery, breeding and
  replacement priorities; and
- sync/freshness/stale-but-usable status.

## Safety and scope

The Pro League workspace is private, owner-only and advisory.

It must not:

- create or submit a team;
- submit a roster or map assignment;
- choose, deny or submit a map for a scheduled match;
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
