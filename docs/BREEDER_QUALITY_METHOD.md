# Breeder Quality Method

Status: **owner-approved analytical foundation**  
Effective: **30 August 2026**

## Purpose

DNA Racing Intelligence must distinguish two different reasons a Core may be valuable for breeding:

1. **elite racer quality** — the Core itself demonstrates exceptional racing performance; and
2. **elite breeder quality** — the Core's offspring repeatedly outperform what those specific matings were reasonably expected to produce.

A Core may qualify through either path or both. An average racer must not be excluded from breeding consideration when its offspring history provides strong evidence that it is an exceptional breeder.

The integrated breeding layer is implemented in:

- `domain/breeding-recommendation.ts` — elite direct-racer assessment;
- `domain/breeder-quality.ts` — historical offspring breeder assessment; and
- `domain/breeding-intelligence.ts` — combined racer/breeder parent and pair identification.

## Owner-provided offspring distribution clarification

The owner-provided offspring trait distribution chart shows the qualitative breeding concept that:

- offspring outcomes are probabilistic rather than deterministic;
- the densest/most common outcomes are weaker than the parents' baseline;
- stronger-than-parent outcomes occur less often;
- rare exceptional outcomes occupy the far stronger tail; and
- the objective of long-term vault improvement is to repeatedly identify and reproduce those exceptional outcomes where evidence supports doing so.

The chart is **qualitative evidence only**. Do not infer exact probabilities, standard deviations, distribution parameters or hidden DNA formula values from the artwork.

This remains consistent with the existing confirmed breeding authority: most breed rolls may be weaker, stronger offspring are less common, and rare exceptional/supernatural offspring can be materially stronger.

## New owner clarification: breeder ability can differ from racer ability

Treat the following as an owner-confirmed strategic premise for analysis:

- some Cores may produce strong offspring more consistently than others;
- an elite racer may or may not be an elite breeder;
- an average racer may still be an elite breeder;
- repeated exceptional offspring from the same parent are evidence worth investigating;
- repeating a successful parent with a different co-parent may test whether the signal belongs to the parent rather than one fortunate mating; and
- pairing two historically exceptional breeders is a valid hypothesis to evaluate.

This is not a claim that breeder propensity is a proven hidden genetic variable. The website must test whether the historical signal survives proper controls and chronological validation.

## Why raw elite-child counts are not enough

Do **not** rank breeder quality by simply counting how many elite children a Core has produced.

That would confound the parent's breeder contribution with:

- the quality of the co-parent;
- the expected strength of that particular pair;
- number of breeding opportunities;
- whether offspring were actually raced enough to reveal their ability;
- which modes/distances were tested;
- generation/class/F-number/element context;
- historical population strength; and
- luck from one rare exceptional roll.

A parent repeatedly bred to elite mates could otherwise look like an elite breeder even when the children perform exactly as expected.

## Core concept: offspring lift relative to the mating baseline

For each offspring, first estimate the quality that the pair was expected to produce **using only information available before that offspring was created**.

The expected-offspring baseline may eventually use chronologically valid features such as:

- father and mother racing quality by mode/distance;
- father and mother historical breeder quality known before the mating;
- lineage evidence known before the mating;
- prior offspring known before the mating;
- class pairing;
- element pairing;
- F-number/generation;
- parent sex/role; and
- historically validated features that add out-of-sample predictive lift.

Then compare the child's observed racing quality with that frozen expectation.

Conceptually:

`offspring lift = observed offspring quality - expected offspring quality for that mating`

The production domain stores percentile-based quality rather than assuming a particular physical unit for this lift.

## Exceptional offspring outcome

An exceptional offspring outcome must satisfy **both** an absolute-quality and relative-surprise test.

Initial configurable foundation:

- offspring racing quality must be at or above the **95th percentile** of the applicable population benchmark; and
- the offspring residual/lift must be at or above the **90th percentile** of comparable historical offspring residuals.

This distinction is important.

Example:

- Child A is a 98th-percentile racer from parents whose mating model expected only a 60th-percentile child. This is a strong exceptional-breeding signal.
- Child B is a 98th-percentile racer from a mating already expected to produce a 97th-percentile child. Child B is elite, but it is not equally strong evidence that either parent has unusual breeder lift.

## Offspring performance evidence

Each offspring must have adequate racing evidence before it can contribute to breeder-quality ranking.

The initial foundation requires:

- at least 5 usable racing observations for the offspring quality assessment; and
- at least 25 comparable population observations/cores in the benchmark.

These are configurable analytical defaults, not hidden DNA rules.

An untested or barely tested child is **unknown**, not a weak offspring.

## Mode separation

Breeder quality is mode-aware.

Bike, Car and Horse offspring outcomes must never be mixed automatically.

A Core may therefore be:

- an elite Bike breeder;
- an average Car breeder;
- unknown as a Horse breeder; or
- any other evidence-supported combination.

The same strict separation used for racer performance applies to breeder evidence.

## Exact-distance versus mode-wide breeder evidence

The breeder model supports two scopes:

- **exact-distance breeder quality** — offspring outcomes evaluated at a specific mode + distance; and
- **mode-wide breeder quality** — offspring outcomes evaluated using a whole-mode offspring quality summary.

For a requested exact-distance breeding objective:

1. use exact-distance breeder evidence when enough offspring evidence exists;
2. otherwise use mode-wide breeder evidence as broader supporting breeder propensity; and
3. never let mode-wide positive evidence override materially negative exact-distance offspring evidence once adequate exact-distance evidence exists.

This prevents a generally good breeder from being automatically labelled a specialist breeder at every distance.

## Repeatability and co-parent diversity

One exceptional child is valuable evidence but may simply be a rare lucky roll.

Initial breeder status behavior:

### TARGET

A parent can become an elite breeder `TARGET` only when it has:

- at least 3 performance-qualified offspring;
- offspring produced with at least 2 distinct co-parents;
- median offspring lift ranking at or above the 95th percentile of the breeder benchmark; and
- shrinkage-adjusted exceptional-offspring rate ranking at or above the 90th percentile.

### WATCH

Use `WATCH` when, for example:

- one exceptional offspring exists but there are too few total offspring;
- repeated strong offspring all came from the same co-parent;
- breeder score is promising but one elite gate remains unresolved; or
- offspring performance coverage is still developing.

### WAIT

Use `WAIT` when:

- there is no qualified offspring evidence;
- offspring are consistently average or weaker than mating expectations;
- prolific breeding volume exists without positive lift; or
- the historical signal does not rank strongly against other breeders.

## Shrinkage against small-sample luck

Raw exceptional-offspring rates are unstable for parents with few offspring.

The initial foundation therefore shrinks each parent's elite and exceptional offspring rates toward the population rate before comparing breeders.

This means:

- `1 exceptional child / 1 child` is not treated as a proven 100% exceptional breeder;
- repeated outcomes gradually overcome the population prior; and
- prolific average breeders receive no quality bonus merely for volume.

The prior strength is configurable and must later be calibrated through historical validation.

## Breeder score

The current explainable breeder score uses population-relative components:

- 55% median offspring-lift benchmark percentile;
- 30% shrinkage-adjusted exceptional-offspring-rate benchmark percentile; and
- 15% shrinkage-adjusted elite-offspring-rate benchmark percentile.

The score is supporting ordering evidence. `TARGET` still has explicit hard gates, so a high child count or one secondary metric cannot compensate for weak repeatable lift.

## Confidence is not breeder quality

Breeder confidence depends on the amount and diversity of offspring evidence.

Initial confidence rules:

- high: at least 8 qualified offspring across at least 3 co-parents;
- moderate: at least 3 qualified offspring across at least 2 co-parents;
- low: anything less.

A low-confidence parent may have exciting breeder upside. A high-confidence parent can be confidently mediocre.

Never convert confidence into a quality bonus.

## Integrated parent qualification

The higher-level breeding intelligence layer now recognizes four useful parent states:

- **elite racer** — own racing performance clears the strict direct-racer gate;
- **elite breeder** — offspring history clears the strict breeder gate even if own racing is average;
- **dual** — both elite racer and elite breeder; and
- **WATCH / none** — evidence is promising or insufficient but not elite-qualified.

A Core is eligible as a breeding `TARGET` when it independently clears either elite racer quality or elite breeder quality, subject to availability and official breeding rules.

## Integrated pair strategies

The system explicitly supports:

### Racer × Racer

Both parents qualify through their own elite racing performance.

### Racer × Breeder

One parent's direct racing performance is elite and the other contributes proven historical breeder lift.

### Breeder × Breeder

Both parents may be ordinary racers but each has independently demonstrated elite breeder lift through historical offspring.

### Dual-strength combinations

One or both parents may be both elite racers and elite breeders.

These categories are hypotheses to compare historically. No category is assumed to be genetically superior until out-of-sample offspring evidence demonstrates it.

## Pair ranking remains fail-closed

A pairing becomes `TARGET` only when both parents independently clear at least one elite qualification path.

The system must still return `WAIT` when the available population contains no pair meeting the standard.

Family restrictions, availability and official validation remain mandatory.

`pair_info` element/F-number/type and splice cost remain post-quality information. They cannot convert a weak racer/breeder pair into an elite hypothesis.

## Historical parent-offspring dataset

The next analytical research step is to construct a complete parent-offspring outcome dataset.

Where an authoritative direct offspring list is unavailable, derive children by reversing authoritative lineage records:

- child `father_id` -> father offspring list;
- child `mother_id` -> mother offspring list.

Do not infer family relationships by Core name.

For each parent-child relation retain:

- parent ID;
- co-parent ID;
- offspring ID;
- offspring creation/breeding time where authoritative;
- mode;
- exact distance or mode-wide evaluation scope;
- child's race sample and performance distribution;
- child's benchmark quality percentile;
- mating expected-quality estimate frozen before child creation;
- residual/lift percentile;
- evaluation cutoff;
- lineage/class/element/F-number context; and
- source/provenance.

The same child contributes once per parent per evaluation scope. Duplicate lineage records must not increase evidence counts.

## Chronological validation is mandatory

Breeder quality is particularly vulnerable to leakage because mature offspring performance is observed after breeding.

For every historical offspring:

- freeze the expected-mating model at or before offspring creation;
- never use the child's later racing results to construct its own expectation;
- never use later offspring from that parent in an earlier mating prediction;
- train breeder models on earlier cohorts;
- validate on later unseen offspring; and
- compare with simple baselines that use parent racer quality only.

A breeder feature is useful only if it improves later-offspring prediction out of sample.

## What would constitute real evidence of an elite breeder

Strong evidence would look like a parent that, across multiple independent matings:

- repeatedly produces children materially stronger than their mating expectations;
- produces elite children at a rate materially above comparable breeders;
- retains the signal after controlling for co-parent quality;
- retains the signal across later unseen offspring; and
- ideally shows useful consistency across more than one co-parent and breeding cycle.

An average racing Core meeting those tests should outrank an elite racer with poor historical offspring production when the breeding objective is exceptional-offspring probability.

## Data-source boundary

The current production DNA Open Lab API contract supplies current identity, lineage/splicing and Arena facts, but the repository currently classifies full historical elapsed-time outcomes as unavailable on the API-only production path.

Therefore:

- the breeder-quality domain logic is implemented now;
- breeder scores must remain unavailable where offspring performance evidence is unavailable;
- no missing child history is interpreted as poor breeder performance;
- research/validation may use approved historical evidence harnesses; and
- the production website must not silently reactivate a deprecated data source or fabricate outcome history merely to populate breeder scores.

When a complete approved historical outcome path is commissioned, this domain foundation can be connected without changing the core methodology.

## Relationship to the owner-provided chart

The chart motivates the **exceptional-outcome tail objective** but does not determine the scoring formula.

The website's job is to estimate, from actual historical offspring, which parents appear to shift probability mass toward that stronger tail relative to mating expectations.

That is the empirical definition of breeder lift we are trying to discover.

## Future model expansion

Later P9/F3 work should test:

- parent-specific random effects / hierarchical breeder models;
- father versus mother breeder effects;
- breeder-by-co-parent interaction effects;
- breeder-by-mode and breeder-by-distance effects;
- whether breeder quality persists across breed cycles;
- whether prior offspring class/element/F-number affects expected outcomes;
- lineage-level breeder propensity;
- whether exceptional breeders themselves descend from exceptional breeders;
- whether elite-breeder × elite-breeder pairings outperform racer-only baselines;
- whether elite-racer × elite-breeder combinations outperform racer × racer;
- Gold/Blue or other hidden-signal incremental lift only after chronological validation; and
- calibration of the probability of weaker, comparable, stronger and exceptional offspring.

## Safety and interpretation

- This system remains advisory only.
- It does not claim the hidden DNA breeding formula has been discovered.
- It does not guarantee that a historically elite breeder will produce another elite offspring.
- It does not initiate a splice, wallet signature or game transaction.
- Every recommendation must retain sample size, co-parent diversity, uncertainty and historical cutoff evidence.
