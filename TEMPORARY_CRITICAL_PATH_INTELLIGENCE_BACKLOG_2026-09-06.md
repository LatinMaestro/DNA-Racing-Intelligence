# TEMPORARY Critical-Path Intelligence Backlog — 6 Sep 2026

> **DO NOT MERGE / DO NOT CHERRY-PICK WITHOUT LIVE REVALIDATION.**
>
> This file converts the 5–6 Sep live racing, breeding, Esports trial and BLACK SHEEP benchmark work into a future implementation backlog. It is intentionally more concrete than the strategic handoff. No main/code/provider/database/deployment/game action is authorised by this document.

# 1. Critical-path principle

The website's immediate mission remains **private Pro League commissioning**. The new intelligence belongs inside that critical path, then should be reused across the whole vault.

Do not create separate competing algorithms for Pro League, Discovery, Breeding and Lifecycle. Build one evidence engine that can answer different decision questions.

Recommended insertion:

- P6 — roster domain and structural constraints
- P7 — transparent Core evidence engine
- **P7A — Map & Opponent Intelligence**
- P8 — Discovery experiment engine
- P9 — Breeding/Splice intelligence + offspring feedback loop
- P10 — owner-usable Pro League Command Centre
- F1/F3/F5/F6 — reuse the same evidence for Core Intelligence, Breeding, economics and lifecycle

---

# 2. Evidence primitives to implement before ranking logic

## 2.1 Exact-distance profile

One record/profile per Core × mode × distance × evidence window/version.

Minimum concepts:

- Core ID;
- mode;
- exact distance;
- sample count;
- median elapsed time;
- median speed;
- best speed / upper-tail speed;
- variance / standard deviation / CV where available;
- win rate and podium rate as separate fields;
- paid/Free split;
- recent-N and lifetime sample;
- source time window;
- retrieval timestamp;
- benchmark cohort ID/version;
- global-average relative speed;
- eventual true percentile/rank only where the API/data actually supports it;
- confidence state: provisional / minimum / meaningful / deep;
- freshness.

Important: **do not call global-average-relative percentage a percentile.** These are different concepts.

## 2.2 Format profile

Per Core × distance × format/gate/team context:

- 1v1;
- WTA by relevant gate bands;
- Madness by relevant team/gate bands;
- starts;
- individual finishing distribution;
- team win contribution;
- stars;
- opponent quality / field quality when estimable;
- speed evidence where exact elapsed time is available.

Do not aggregate format away simply to increase sample size.

## 2.3 Star evidence

Store Blue and Yellow stars as their own evidence family:

- race ID;
- Core ID;
- star type;
- distance;
- format;
- field/opponent context;
- timestamp;
- source provenance.

Then derive explicit state:

- `agrees_with_speed`;
- `conflicts_with_speed`;
- `insufficient_speed_evidence`;
- `insufficient_star_evidence`.

Regression cases:

- Peak Crown 2200 = agreement;
- Cyber Overdrive 1600 = conflict;
- Creeper 1600 vs 2200 = star signal at one distance, speed preference at another;
- Frozen Blade 1000 = stars cannot manufacture strong central speed.

## 2.4 Current-state API observations

Power, adjusted odds, variance, stamina, listing, equipped assets and splice state must be stored with observation timestamps and kept out of historical backtests unless a contemporaneous snapshot existed.

---

# 3. Roster intelligence model

## 3.1 Roster slot is a role assignment

Every selected Core needs one or more explicit roles, for example:

- 1000 1v1 weapon;
- 1200 small-WTA weapon;
- 1400 Glory weapon;
- 1600 Measure/multi-format weapon;
- 1800 middle anchor;
- 2000 long weapon;
- 2200 long weapon;
- large-gate Miracles contributor;
- multi-distance reserve;
- compliance slot that still carries meaningful performance value.

The UI must answer **why this Core occupies a roster slot**.

## 3.2 Marginal roster value

Do not rank 1–25 using one global score. Compute the value of adding a Core to the current selected set.

Suggested components:

- performance upgrade over current best at target roles;
- role coverage gained;
- second-option/redundancy gained;
- multi-map flexibility gained;
- opponent-specific usefulness;
- early-order usefulness;
- structural compliance impact;
- evidence confidence;
- ageing/stamina cost;
- annual substitution cost if already in-season.

A candidate with slightly lower raw speed can be more valuable if it fills an otherwise uncovered map/format role.

## 3.3 Redundancy penalty

Penalise a new Core if:

- its useful roles are already covered by stronger Cores;
- it consumes a saturated Metal/F≤5/F≤10 band;
- it adds another Water/high-F role while Fire/Earth performance gaps persist;
- it has no map/format role that changes expected matchup outcomes.

## 3.4 Gap states

A vault gap needs at least two states:

1. **structural candidate exists** — element/F/type/gender requirement can be met;
2. **performance-qualified gap filled** — a Core has enough evidence to perform the role competitively.

Example: Frozen Blade structurally creates an Earth F16 candidate, but does not yet permanently close the high-F Earth Sprint gap until the correct 1200/1400 evidence validates.

---

# 4. Map engine

## 4.1 Canonical map-race definition

Persist/version each map's full ordered race sequence:

- map name/version/season;
- race ordinal 1–42;
- distance;
- format;
- gate/team size;
- any restrictions;
- observed rule/source provenance.

Do not hardcode map details in UI components.

## 4.2 Race execution probability

For each map and season/era, learn:

- probability ordinal 1 executes;
- probability ordinal 2 executes;
- ... ordinal 42;
- distribution of map-ending ordinal;
- conditional probability based on score state if available.

Mapping objective should weight expected value by these probabilities.

This is strategically important because the owner wants strongest weapons concentrated in races most likely to occur.

## 4.3 Mapping optimiser

For every race line, return:

- recommended Core(s);
- backup Core(s);
- evidence dimensions;
- expected role fit;
- ageing/stamina exposure;
- reason for assignment;
- confidence;
- alternative if a Core is unavailable.

Global mapping constraints should include repeated-use cost so one superstar is not overused unnecessarily.

## 4.4 Map strength score

Do not score a map only by average Core quality. Include:

- number of races with elite primary coverage;
- number with strong backup coverage;
- weak race clusters;
- early-race weakness;
- format-specific holes;
- expected score-weighted coverage based on execution probability.

---

# 5. Opponent Intelligence (P7A)

## 5.1 Opponent team snapshot

Persist/version:

- team ID/name;
- vault;
- roster version/time observed;
- roster Core IDs;
- roster composition;
- map record all-time / current-roster era / recent-N;
- home-map choices;
- map veto/elimination behaviour if observable;
- substitutions/roster turnover when observable.

## 5.2 Opponent Core usage profile

Per opponent Core:

- distance use;
- format use;
- map use;
- race-order use;
- global-relative speed profile;
- stars/team contribution;
- current evidence freshness.

## 5.3 Matchup engine

For each possible Latin home map:

- our expected strength by race line;
- opponent expected strength by race line;
- early-race edge;
- weak opponent clusters;
- our weak clusters;
- confidence;
- suggested home map;
- suggested counter-mapping.

Do not simply choose Latin's historically strongest map. Choose the map with best **relative expected edge versus that opponent**.

### BLACK SHEEP regression test

With the captured snapshot, the engine should identify **Anchor as the first map to investigate when Latin is home**, because BLACK SHEEP's captured Anchor record was materially weaker than Measure/Glory/Miracles and they largely avoided Anchor as a home choice.

The engine should not decide this from team reputation or overall match win rate.

---

# 6. Discovery experiment engine (P8)

## 6.1 Discovery hypothesis entity

Fields/concepts:

- Core;
- hypothesis statement;
- target distance(s);
- target category Sprint/Middle/Marathon;
- expected roster/vault role;
- evidence that motivated test;
- baseline sample;
- target sample checkpoints;
- maximum planned evidence budget;
- ageing/stamina/economic cost;
- created time;
- current state.

## 6.2 Checkpoint engine

Working owner doctrine:

- n<5 = provisional;
- around n=5 = first useful checkpoint;
- n≈10 = meaningful confirmation;
- n≈20 = deep target where justified;
- stop or redirect early if evidence is clearly weak.

Checkpoint decisions:

- continue same distance;
- promote;
- redirect adjacent distance;
- broaden category;
- stop testing;
- breeder-only observation;
- hold.

## 6.3 Expected decision value

Prioritise a test by something like:

`probability candidate changes a meaningful decision × value of that decision / resource cost`.

Inputs:

- current evidence uncertainty;
- potential performance ceiling;
- current roster gap;
- incumbent weakness;
- structural value;
- ageing cost;
- stamina;
- Free-race availability;
- how many later decisions would be unlocked.

### Regression cases

- Frost Rocket 1000: n≈4 strong -> high decision value to get one/few more observations.
- Livid Jaguar 1600/2000: exceptional n≈4 -> very high decision value.
- Flux Dagger 2000: strong n≈3 -> high value.
- Lynx Mystic current weak/near-low evidence -> lower priority.
- Final Flash: 2200 evidence weak + pedigree says 1400 -> redirect instead of spending more 2200 ageing.

---

# 7. Breeding intelligence engine (P9)

## 7.1 Separate runner and breeder profiles

Never let runner score stand in for breeder score.

### Runner profile

- exact-distance central speed;
- ceiling;
- consistency;
- format/map usefulness;
- sample depth/recency;
- population-relative evidence.

### Breeder profile

- all known offspring count;
- sufficiently raced offspring count;
- unresolved offspring count;
- median child quality;
- best child quality;
- elite-tail rate;
- weak-child rate;
- offspring variance;
- distance inheritance distribution;
- structural outcomes;
- different-mate repeatability;
- chronology-controlled parent lift where available;
- confidence/shrinkage.

## 7.2 Exact-pair profile

Per sire × dam pair:

- offspring list;
- creation dates;
- offspring performance distribution;
- repeated distance patterns;
- elite-tail count;
- weak outcome count;
- pair synergy versus parent baseline;
- confidence;
- whether another repeat is currently possible.

BLACK SHEEP's Game Over × Mean Neighbor family is the benchmark regression example for why this is needed.

## 7.3 Pair recommendation explanation

Show separately:

- target role/gap;
- distance alignment;
- sire runner quality;
- dam runner quality;
- sire breeder quality;
- dam breeder quality;
- exact pair evidence;
- projected child traits from `pair_info`;
- structural value;
- elite-tail upside;
- ordinary/weak-outcome risk;
- current cycle/lifetime splice scarcity;
- relation/lineage warnings;
- official price;
- `pair_validate` status;
- expected all-vault utility beyond Esports.

## 7.4 Scarce splice decision rule

For low lifetime-capacity Cores, raise the evidence threshold. The UI should visibly distinguish:

- effectively abundant/high-capacity breeder;
- normal finite breeder;
- scarce 3-lifetime-splice asset;
- final-lifetime-splice decision.

## 7.5 Unproven breeder rule

If credible breeder proof is absent, require genuinely elite population-relative racing evidence at the target distance before promoting the pair.

A small local Trainer percentile is not enough.

## 7.6 Completed-cohort feedback loop

The 5 Sep offspring set is the best regression fixture for this workflow:

- Frozen Blade = structural high-F Earth candidate, racing role unresolved;
- Frost Rocket = strong early Sprint signal at insufficient n;
- Cyber Overdrive = star/speed conflict;
- Iron Dynamo = successful-family repeat, individual still unresolved;
- Nervy Runner = strong child strengthening pair-repeat confidence;
- Creeper = discovered distance differs from initial star signal;
- Final Flash = wrong-distance trial redirected to pedigree-aligned band;
- Peak Crown = intended Long breed validated strongly by speed + stars.

The product should automatically update parent and exact-pair evidence as each child develops.

---

# 8. Vault Development Board

A whole-vault page should answer:

## 8.1 Where are we strong?

Heatmap by:

- 1000 / 1200 / 1400 / 1600 / 1800 / 2000 / 2200;
- format;
- map;
- element;
- F-band;
- confidence.

## 8.2 Where are we weak?

Examples of current strategic objectives that must be refreshed live:

- Fire F16–20 performance depth;
- Earth F16–20 performance depth;
- Earth F11–15;
- Fire F11–15;
- non-Metal 1000–1200 F11+;
- any specific map/format cluster with no elite primary/backup.

## 8.3 What is the next best action?

For each gap show ranked alternatives:

1. use an existing proven Core;
2. test an unresolved Core;
3. redirect an existing Discovery Core;
4. breed internally;
5. use external Arena stud;
6. watch/acquire external Core in future;
7. accept gap temporarily if resource cost is too high.

The site should not reflexively recommend breeding when one cheap discovery test could solve the gap.

---

# 9. Lifecycle decision model

Lifecycle advice should combine:

- racer value;
- breeder value;
- current roster role;
- Tournament/Maiden value;
- ageing;
- stamina;
- splice scarcity;
- structural scarcity;
- duplicate/redundant role;
- unresolved evidence;
- current market/listing only as current context, not fair-value truth.

States can include:

- elite racer / protect;
- roster nucleus;
- map specialist;
- reserve;
- discovery;
- breeder / breeder prospect;
- protected scarce-splice asset;
- Tournament/Maiden asset;
- hold;
- sale/exit candidate;
- burn candidate only where strategically/legal appropriate and never for protected Genesis.

A weak racer with strong breeder proof must not be auto-sold/burned.

---

# 10. Concrete future development slices

These are suggested dependency-ready slices, **not instructions to implement now**.

## Slice P7.1 — evidence primitives

- exact-distance profile object/read model;
- benchmark versioning;
- sample/confidence states;
- star evidence relation;
- explicit star/speed agreement state;
- leakage-safe current observations.

Acceptance: Peak Crown, Cyber Overdrive and Creeper examples evaluate correctly.

## Slice P7.2 — roster role model

- role vocabulary;
- role assignment;
- marginal contribution calculation;
- structural/gap states;
- explain-why-selected output.

Acceptance: the engine can retain a slightly lower generic-ranked Core because it uniquely fills a needed role, and reject a redundant 25th slot.

## Slice P7A.1 — map rule/version model

- exact race sequence;
- race order;
- format/distance/gate metadata;
- season/version authority.

## Slice P7A.2 — opponent snapshot + history

- team roster snapshots;
- map record by era;
- home choices;
- Core usage by map/distance/format.

## Slice P7A.3 — race-order execution model

- ending-ordinal distribution;
- execution probabilities;
- ageing exposure.

## Slice P7A.4 — matchup mapper

- our strength versus opponent strength per race line;
- home-map recommendation;
- counter-mapping;
- confidence/freshness.

Acceptance: BLACK SHEEP snapshot points toward Anchor investigation rather than blindly selecting Miracles/Measure.

## Slice P8.1 — Discovery hypothesis/checkpoint persistence

- hypothesis;
- baseline;
- n≈5/n≈10/n≈20 checkpoints;
- redirect/stop decisions;
- history.

## Slice P8.2 — Discovery decision-value queue

- expected information gain;
- roster/gap impact;
- ageing/stamina cost;
- active-race opportunity matching.

## Slice P9.1 — breeder profile

- all offspring;
- elite-tail/median/weak-child distribution;
- shrinkage;
- multiple-mate evidence.

## Slice P9.2 — exact-pair repeat profile

- sibling group detection;
- pair synergy/lift;
- repeat recommendation state.

## Slice P9.3 — gap-driven pair search

- current structural/performance gaps;
- owned parents + Arena;
- distance alignment;
- official `pair_info` projection;
- scarce splice/cost display;
- official `pair_validate` execution gate.

## Slice P9.4 — offspring development feedback

- automatically create child hypothesis after observed new offspring;
- update parent/pair breeder profiles as evidence grows;
- mark gap candidate vs performance-qualified closure.

## Slice P10.1 — Pro League Command Centre integration

One owner page/workflow should expose:

- current roster and role of every slot;
- legal compliance;
- marginal/replaceable slots;
- all four map coverage;
- current next opponent;
- recommended home map and why;
- early-order mapping;
- substitution budget;
- Discovery queue;
- Breeding queue;
- structural/performance gaps;
- evidence freshness/sync state.

---

# 11. Regression scenarios future code should encode

1. **Cyber Overdrive 1600:** five Blue Trial assignments but below-global median -> not a 1600 promotion.
2. **Peak Crown 2200:** strong sample + strong global-relative speed + Blue/Yellow support -> confidence increases.
3. **Creeper:** 1600 stars but stronger 2200 central speed -> preferred distance redirects Long.
4. **Final Flash:** poor 2200 evidence plus Drift King 1400 parent hypothesis -> redirect 1400/1600, not discard.
5. **Frost Rocket:** strong n≈4 -> high-upside provisional, not proven.
6. **Livid Jaguar / Flux Dagger:** spectacular tiny samples -> high-priority Discovery, not immediate elite classification.
7. **Low on Dough / BLNT historical decision:** available Arena mare is not automatically worthy of a final lifetime splice when the broader population contains stronger alternatives.
8. **Iron Dynamo:** exact repeat successful family does not guarantee elite individual outcome.
9. **Nervy Runner:** strong new sibling can increase confidence in a repeat family.
10. **BLACK SHEEP:** dominant overall opponent still has a map-specific relative weakness; matchup engine must find it.
11. **Miracles:** strong opponent depth does not mean Latin should devote disproportionate development resources to mirroring that strength.
12. **Gap closure:** a child with the right F/element is only a structural candidate until racing quality validates.

---

# 12. Data freshness and authority guardrails

Every output needs:

- source family;
- source timestamp;
- retrieval timestamp;
- dataset/snapshot version;
- benchmark cohort/version;
- freshness state;
- owner strategy version;
- confidence/evidence state.

Named-Core values in the 6 Sep handoffs are **snapshots**, not permanent constants. Future code should recompute from live API truth.

Strategy is more durable:

- speed/performance first;
- stars supporting only;
- role-based roster construction;
- opponent-specific map strategy;
- early-order weighting;
- hypothesis-led Discovery;
- separate runner/breeder models;
- structural + exceptional-upside breeding;
- scarce-resource awareness;
- advisory/manual game actions only.

---

# 13. Definition of strategic completion

Before private Pro League commissioning can be called strategically complete, the website should be able to answer, from fresh evidence:

1. What is our best legal roster and why is each slot there?
2. Which selected slots are marginal/replaceable?
3. Where are our exact distance/format/map weaknesses?
4. Which map should we choose against the **next specific opponent**, and why?
5. Which elite Cores belong in the most likely-to-run early races?
6. What substitutions would materially improve the team, and what annual budget remains?
7. What are the next highest-value Discovery tests?
8. What are the next highest-value breeding objectives/pairs?
9. Which gaps are merely structurally filled versus performance-qualified?
10. What scarce resources would each recommendation consume?
11. Which evidence families agree, conflict or remain insufficient?
12. How fresh is the evidence and what changed since the last decision snapshot?

After P10, the same engine should answer the wider-vault versions of these questions for breeding, discovery, tournaments, economics and lifecycle rather than creating separate scoring systems.