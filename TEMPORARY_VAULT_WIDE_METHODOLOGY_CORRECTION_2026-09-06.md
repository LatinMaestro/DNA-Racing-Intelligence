# TEMPORARY Vault-Wide Methodology Correction — 6 Sep 2026

> **DO NOT MERGE / DO NOT CHERRY-PICK WITHOUT LIVE REVALIDATION.**
>
> This document corrects any ambiguity in the earlier strategic handoffs. The analytical methodology is **vault-wide and role-wide**, not centred on any named Core. Named Cores such as Peak Crown, Cyber Overdrive, Titan Mage, BLACK SHEEP examples, etc. are only worked examples/regression fixtures showing how the methodology should behave under known evidence patterns. They must never become hardcoded anchors, fixed targets or privileged inputs in production logic.

## 1. Binding owner clarification

The owner wants the lessons from BLACK SHEEP and the recent Latin Racing trial/breeding analysis applied to the **entire vault-development system**:

- every owned Core;
- every relevant distance;
- every map and race format;
- every roster role;
- every known breeder and offspring family;
- every exact parent pair;
- every unresolved Discovery candidate;
- every structural element/F/gender/type gap;
- every acquisition/Arena watch opportunity;
- every lifecycle decision;
- and every opponent matchup.

No methodology should start with a predetermined list of favourite named Cores. The process must scan the complete relevant universe first, then surface the best opportunities from current evidence.

## 2. BLACK SHEEP learning is a process benchmark, not a Core-copy exercise

What should be copied from BLACK SHEEP is the **system**:

1. almost no dead roster slots;
2. strong exact-distance performance across the whole active roster;
3. high multi-distance redundancy;
4. clear specialist and multi-role coverage;
5. map/format-specific deployment rather than generic overall ranking;
6. deep but purposeful testing;
7. rapid promotion/rejection/replacement of marginal Cores;
8. repeated successful breeding families and exact pairs;
9. high-F depth while still using low-F allowances efficiently;
10. opponent-specific map strategy.

Do **not** copy BLACK SHEEP's named Cores, element balance, race volume, map preferences or breeding pairs mechanically. Those are examples of what its system produced, not rules for Latin Racing.

## 3. Required vault-wide analytical loop

The website should continuously execute this logic over the whole vault:

### A. Inventory and evidence scan

For every owned Core, build current evidence by:

- exact distance;
- format/gate/team context;
- map;
- recent vs lifetime;
- median speed;
- best-speed ceiling;
- consistency/CV;
- global-relative benchmark;
- sample depth;
- win/podium outcome;
- Blue/Yellow stars;
- current power/adjusted odds/variance;
- stamina/readiness;
- ageing;
- element/F/gender/type;
- lineage and breeder evidence;
- lifecycle/splice scarcity.

### B. Role map

Independently of current roster membership, determine the best candidate pool for every role:

- 1000 / 1200 / 1400 / 1600 / 1800 / 2000 / 2200;
- 1v1;
- small-gate WTA;
- large-gate WTA;
- small-team Madness;
- large-team Madness;
- Anchor-specific roles;
- Glory-specific roles;
- Measure-specific roles;
- Miracles-specific roles;
- early-map race-order roles;
- multi-distance utility roles.

A Core can own multiple roles. The system should measure depth behind the #1 candidate, not only identify the top one.

### C. Vault gap detection

For each role, classify:

- elite depth;
- adequate depth;
- fragile depth;
- unresolved upside;
- true gap.

Then cross this with structural rules and long-term vault composition:

- element caps/headroom;
- F bands;
- female requirement;
- high-F quality by element;
- Genesis/protected assets;
- ageing distribution;
- substitution cost;
- breeder depth.

### D. Decision queues

Generate from the full-vault scan:

1. **Roster queue** — best legal role portfolio, not top 25 by one score.
2. **Discovery queue** — tests with highest expected decision value per ageing/stamina/cost.
3. **Breeding objectives** — unresolved persistent role/structure gaps plus exceptional-tail opportunities.
4. **Breeding pair queue** — search all viable owned/Arena parents matching those objectives; do not begin with named pairs.
5. **Arena/acquisition watchlist** — external Cores that materially upgrade a role or breeder line.
6. **Lifecycle queue** — protect, race, discover, breed, hold, reserve, Tournament/Maiden use, sell/exit, etc.

## 4. Breeding methodology must be universe-first

The breeding engine should not ask 'which mate should Core X use?' unless the owner explicitly starts from Core X. Its default question is:

> **What are the highest-value breeding opportunities available right now for this vault?**

The sequence is:

1. identify vault performance/structure gaps and upside opportunities;
2. scan every viable sire and dam in the owned vault and current Arena;
3. evaluate runner evidence for each parent;
4. evaluate breeder evidence for each parent across **all known offspring**;
5. detect exact-pair repeat success;
6. check target-distance/category alignment;
7. inspect projected child element/F/type;
8. account for lifetime/cycle splice scarcity and stud cost;
9. exclude close-family/invalid pairs;
10. validate leading pairs with official `pair_validate` before calling them executable.

### Runner proof rule

Where breeder proof is absent or weak, the parent must earn inclusion through elite population-relative racing evidence at the intended distance/category. Attractive F/type outcomes alone are insufficient.

### Breeder proof rule

Do not infer breeder quality from one famous child. Evaluate all offspring, shrink small samples and measure:

- child median quality;
- elite-tail rate;
- weak-child rate;
- repeat performance across different mates;
- repeat exact-pair outcomes;
- distance inheritance;
- child lift relative to parental expectation where chronology allows.

## 5. Discovery methodology must be vault-first

The Discovery system should scan **every insufficiently resolved Core**, not just the current roster or newest offspring.

Prioritisation should depend on:

- probability of elite performance;
- current sample uncertainty;
- role/vault gap the Core could solve;
- quality of incumbent at that role;
- structural value;
- lineage hypothesis;
- race/ageing/stamina cost;
- number of future decisions unlocked by the result.

Named Cores from current analysis should exist only as regression scenarios such as:

- star/speed disagreement;
- wrong-distance redirect;
- strong tiny-sample signal;
- successful new breed;
- failed expected repeat;
- multi-distance breakout.

The engine must discover equivalent future cases automatically in any Core.

## 6. Whole-vault development objectives learned from BLACK SHEEP

Latin Racing should aim to evolve toward these **portfolio properties**, not named-Core outcomes:

### A. No dead roster slots

Every selected Core should have at least one defendable role with evidence. A legal but weak filler is a development problem.

### B. Multi-distance redundancy

Each major distance should ideally have:

- at least one elite first choice;
- a credible second option;
- selected multi-role Cores that can cover adjacent distances/formats.

The exact target depth should be map-weighted rather than identical for every distance.

### C. High-F performance depth

Do not chase F-number for its own sake. Develop high-F Fire/Earth/non-Metal quality because it creates roster flexibility where current low-F/Metal allowances become saturated. The requirement is **high-F + elite performance**, not high-F alone.

### D. Map-specific squads inside one roster

Treat the Pro League roster as overlapping sub-squads:

- Anchor weapons;
- Glory weapons;
- Measure weapons;
- Miracles defence/steal depth.

Then optimise shared Cores that cover multiple squads efficiently.

### E. Strong early-map deployment

Measure map-ending distributions and make sure elite coverage exists in race orders most likely to execute.

### F. Breeding families as durable assets

Track breeder lines and exact-pair success across generations. A productive family is vault infrastructure, not just the source of one good racer.

### G. Continuous replacement pressure

For every active roster slot, keep an incumbent-vs-challenger view. Discovery and breeding should be aimed at replacing the weakest marginal role, not merely increasing Core count.

## 7. Product implementation rule

Production code must contain **generic models and queries**, not named-Core rules.

Acceptable named-Core usage:

- fixtures/tests;
- explanatory UI examples;
- owner notes;
- historical decision snapshots;
- regression cases.

Unacceptable named-Core usage:

- hardcoded score bonuses;
- fixed breeding priorities;
- fixed Discovery priorities;
- permanent roster locks;
- map recommendations tied to a Core name;
- logic that assumes today's breakout remains elite after data changes.

All recommendations must be regenerated from current data and strategy authority.

## 8. Regression scenarios from current analysis

Keep current named examples only as test cases for generic behaviour:

- **Peak Crown**: speed + stars agree -> high-confidence promotion case.
- **Cyber Overdrive at 1600**: stars strong, median speed weak -> conflict case.
- **Creeper**: stars at one distance but speed preference elsewhere -> redirect case.
- **Final Flash**: pedigree hypothesis tested at wrong/weak distance -> redirect, not discard.
- **Frost Rocket**: strong n<5 signal -> high-potential but provisional case.
- **Nervy Runner**: sibling-family success strengthening exact-pair breeder evidence.
- **Iron Dynamo**: elite-family repeat does not guarantee elite offspring -> avoid survivorship bias.
- **BLACK SHEEP Anchor weakness**: opponent-specific map recommendation should emerge from data, not fixed preference.

If future data changes, these Cores may move categories; the tests should be about the **evidence pattern**, not eternal classification.

## 9. Critical-path clarification

When Work/code capacity resumes:

- P7 builds the generic evidence engine over the whole vault;
- P7A builds generic map/opponent intelligence over every team and map;
- P8 builds vault-wide Discovery prioritisation;
- P9 builds gap-driven universe-wide breeding search;
- P10 presents the current Pro League decision layer generated from those systems;
- F1/F3/F5/F6 reuse the same generic engine for whole-vault management.

The website should therefore become a **vault-development operating system**, with Pro League as the first commissioned use case — not an esports tool with a few named Core heuristics added later.
