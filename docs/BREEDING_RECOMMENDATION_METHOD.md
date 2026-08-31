# Breeding Recommendation Method

Status: **approved analytical foundation**  
Effective: **30 August 2026**

## Purpose

This document defines the permanent performance-first foundation for future DNA Racing breeding-pair identification.

It applies independently to **Bike, Car and Horse**. A strong result in one mode must never provide performance evidence for another mode.

The objective is not to identify the best pair that happens to be available. The objective is to identify pairings with credible evidence of **exceptional offspring upside** for the requested mode and exact distance. If the available owned and Arena parents do not meet that standard, the correct recommendation is **WAIT**.

This foundation does not claim the hidden DNA breeding formula is known. Parent quality is evidence for a breeding hypothesis only. Offspring hidden racing performance remains probabilistic and non-deterministic.

## Governing principle

**Breed exceptional performance with exceptional performance. Use the rest of the evidence to understand and qualify that performance, not to manufacture a recommendation when elite parents are unavailable.**

## Evidence hierarchy

For a requested mode and exact distance, evaluate evidence in this order:

1. **Exact-mode, exact-distance elapsed-time performance and valid derived speed versus the applicable breeding-universe benchmark.**
2. **Repeatability of elite performance**, led by the median/central distribution and supported by the strong-performance tail.
3. **Overall current Core strength**, including power and adjusted odds where their current API semantics are authoritative for the selected mode.
4. **Full racing profile across all distances** to understand whether the target result is representative, specialised, cross-distance or an isolated observation.
5. **Sample size, freshness and benchmark coverage** as confidence dimensions.
6. **Authoritative supporting evidence**, including Gold/Blue stars, strong-opposition context, format-specific evidence or lineage features only where their semantics and predictive use are valid.
7. **Official pair rules and descriptors**, including family eligibility, `pair_validate` and `pair_info`.

Race wins, podium rate, Arena fee, owned/Arena status, element, F-number and offspring class/type must not substitute for elite performance evidence.

## Raw performance is primary

The parent-ranking gate is deliberately strict.

The initial production foundation in `domain/breeding-recommendation.ts` uses configurable defaults of:

- median exact-distance speed percentile: **95th percentile or better** for `TARGET`;
- median exact-distance speed percentile: **90th percentile or better** for normal `WATCH` consideration;
- strong-performance-tail speed percentile: **90th percentile or better** for `TARGET`;
- exceptional-ceiling speed percentile: **98th percentile or better** may justify `WATCH`, but cannot rescue an ordinary repeatable median;
- minimum exact-distance sample for `TARGET`: **5** usable observations;
- minimum benchmark population for `TARGET`: **25** comparable observations/cores as defined by the upstream benchmark contract;
- supporting power: **80 or better**;
- supporting adjusted odds: **75 or better**.

These are policy defaults, not hidden DNA game rules. They are intentionally configurable as the historical benchmark library, parent-offspring validation and mode-specific evidence improve.

A policy change must remain explicit, tested and documented. It must not be introduced merely to ensure that the current Arena produces a recommendation.

## Race count is confidence, not quality

Race count answers questions such as:

- how stable is the observed median;
- how much confidence should be placed in the apparent performance level;
- is the target distance a meaningful part of the Core's racing history;
- is an apparent specialist conclusion based on a substantial sample or only a few runs.

Race count **does not earn performance points**.

Examples:

- 500 average races do not outrank 20 genuinely elite races because the sample is larger;
- a small elite sample may remain `WATCH` until confidence improves;
- an elite exact-distance performer is not automatically rejected because most of its career occurred at other distances;
- a Core whose target-distance evidence is both sparse and ordinary must not be promoted because its overall race history is extensive.

## Full-distance profile is diagnostic, not a veto

Always inspect the Core's complete distance distribution before describing its likely racing profile.

This prevents a Core from being labelled a sprinter, middle runner or marathon runner merely because a small number of races at one distance were fast.

However, distance-profile shape is context only. If a Core has strong repeatable elite evidence at the target exact distance, a middle- or marathon-heavy broader career must not mechanically erase that exact-distance performance.

The system should therefore expose warnings such as:

- target distance is a minor share of observed career races;
- another distance dominates the career profile;
- target evidence is limited;
- neighbouring-distance evidence supports or conflicts with the target hypothesis.

Those warnings explain the evidence. They do not create a performance bonus or penalty by themselves.

## Repeatable elite level versus isolated ceiling

The model must distinguish:

- **repeatable elite level** — elite median/central performance supported by a strong upper tail; and
- **elite ceiling only** — one or a small number of exceptional runs while the broader exact-distance distribution is ordinary.

An elite ceiling is useful research evidence and may produce a `WATCH` status. It is not sufficient by itself for a `TARGET` recommendation.

This distinction prevents a single extraordinary result from converting an otherwise mid-pack exact-distance profile into a top breeding recommendation.

## Supporting Core strength

Power and adjusted odds are supporting evidence. Under the strict initial policy, both must meet the configured minimum for a parent to become a `TARGET`.

They must never rescue materially weak exact-distance time/speed evidence.

Variance remains context-dependent. Future format-specific breeding work may evaluate whether variance adds predictive value for particular race objectives, but variance is not a generic quality bonus in the foundation ranking.

Current API metrics are timestamped current observations. They must not be leaked backwards into historical parent-offspring validation unless the equivalent observation existed before the historical cutoff.

## Mode separation

Bike, Car and Horse are always independent performance domains.

A breeding target must select exact evidence matching both:

- requested mode; and
- requested distance.

Evidence from another mode cannot fill a missing exact-mode sample. Historical endpoints or source adapters that can return multiple modes must be filtered explicitly before performance aggregation.

Mixed-mode contamination is a fail-closed data-quality error, not an acceptable approximation.

## Exact-distance separation

Exact distance is primary.

Adjacent distances and distance bands may provide context or future predictive features, but they cannot replace the requested exact-distance evidence in the elite gate.

A 1400 m specialist is not automatically a 1200 m breeding target. A broad sprinter may be attractive across several distances only where each recommended distance has its own adequate performance evidence.

## TARGET, WATCH and WAIT

### TARGET

A parent is a `TARGET` only when it independently clears all configured elite gates needed for the current policy.

A pair is a `TARGET` only when **both parents independently qualify as TARGETs**, confirmed family restrictions are clear, availability is acceptable, and no official validation rejects the pair.

### WATCH

Use `WATCH` for potentially exceptional evidence that is not yet strong enough to justify breeding, including:

- elite ceiling but ordinary median;
- elite median with insufficient sample;
- missing supporting current-strength evidence;
- stale evidence;
- unresolved official validation;
- other confidence gaps that do not prove the Core is poor.

A watch list is research inventory, not permission to splice.

### WAIT

Use `WAIT` when:

- no exact evidence exists;
- repeatable raw performance is below the configured elite/watch standard;
- a parent is unavailable;
- a confirmed family restriction blocks the pair;
- official validation rejects the pair; or
- no pair has two parents that independently clear the elite gate.

An empty Arena or an Arena containing only mediocre candidates must therefore return `WAIT`. Never lower the standard to ensure that a pair is shown.

## Arena policy

Arena status affects availability and freshness, not parent performance quality.

External candidates should ultimately be surfaced in three practical groups:

- **TARGET** — elite performance and strength support a serious pairing hypothesis;
- **WATCH** — potentially elite but unresolved evidence remains;
- **WAIT / NO TARGET** — nothing currently available meets the required standard.

Arena price and splice cost must not influence performance ranking. Cost may be displayed after the performance shortlist exists for an owner decision, but a cheaper parent is not a better racing parent because it is cheaper.

## Owned-core policy

Owned Cores receive no performance-ranking bonus.

Owned-owned pairings are filtered from the same quality ranking when the owner wants a no-Arena view. They must not be artificially boosted above stronger external options.

## Family restrictions

Use only confirmed current family restrictions from `GAME_RULES.md` unless owner authority changes:

- parent/child;
- grandparent/grandchild; and
- full siblings sharing both parents.

Do not invent additional restrictions for half siblings, cousins or wider ancestry.

Official `pair_validate` remains the current official validation authority where available. A local family check does not override an official rejection.

## Official pair information

`pair_info` is authoritative for the official offspring preview values it returns, including current baby element, F-number and type/class descriptor.

These descriptors are **post-ranking information**. They must not improve or reduce the performance quality score.

The same is true of cost. Pair cost is an operational/economic decision after quality identification, not a performance feature.

## Star and opposition evidence

Yellow/source-Gold and Blue star meanings are authoritative under `STAR_SIGNAL_SPECIFICATION.md`, but predictive/inheritance use remains controlled. Raw assignment and conversion receive no positive parent-quality weight when opponent quality is weak or unknown.

Stars and strong-opposition evidence may support confidence only where:

- source semantics are authoritative;
- eligibility/denominators are correct;
- field quality is established without future leakage; and
- any use as a breeding predictor has demonstrated chronological predictive lift beyond time-only baselines.

Do not invent star semantics or opponent-strength meaning from incomplete fields.
Opposition-adjusted stars may strengthen the explanation for an elite direct
racer only after intrinsic time evidence. They do not change historical
elite-breeder status until chronological offspring holdout testing proves
incremental lift beyond the time-only, lineage and co-parent baselines.

## Ranking mechanics

The initial parent quality score is intentionally explainable:

- exact-distance performance score = 80% median speed percentile + 20% strong-performance-tail speed percentile;
- supporting strength score = 60% power + 40% adjusted odds;
- displayed quality score = 90% exact-distance performance score + 10% supporting strength score when supporting strength is available.

The `TARGET` gate is independent of the blended score. A parent cannot compensate for failing an elite median gate by having high power, high race count or another secondary input.

Pair quality emphasises the weaker parent so a single exceptional parent cannot hide a mediocre mate.

These formulas are transparent foundation heuristics pending the chronological parent-offspring modelling required by Gate E. They may be replaced or calibrated later only through versioned, tested evidence.

## Breeding-universe benchmark

Upstream analytics must benchmark the target parent against the relevant comparison universe available at the decision timestamp.

For owner breeding review this should normally include:

- all eligible owned Cores; and
- all eligible current Arena Cores available in the same racing mode,

subject to authoritative source freshness and complete candidate acquisition.

Benchmark construction must remain mode-aware and exact-distance-aware. It must not mix Bike, Car and Horse records.

## Confidence is not predicted quality

Confidence depends on evidence quantity and quality, including sample size, freshness and benchmark coverage.

A low-confidence Core can have high observed quality. A high-confidence Core can be confidently average.

Never convert confidence into a performance bonus.

## Future expansion

P9/F3 development should expand this foundation with:

- canonical historical benchmark persistence;
- mode-specific benchmark policies where justified;
- race-format objectives where authoritative evidence exists;
- chronological parent-offspring training/holdout datasets;
- lineage predictive lift;
- previous-offspring evidence;
- validated Gold/Blue incremental lift;
- exceptional-offspring tail calibration;
- Arena freshness/expiry contracts;
- official `pair_validate` and `pair_info` integration;
- separate elite-upside, vault-gap and balanced views; and
- offspring outcome tracking after owner-manual splices.

Future modelling may change calibrated thresholds or scoring weights, but it must preserve the fundamental fail-closed behaviours unless the owner explicitly changes the objective:

- raw exact-distance performance first;
- race count is confidence/context, not quality;
- no cross-mode contamination;
- no mediocre best-available recommendation;
- pair requires two sufficiently strong parents;
- WAIT is a valid outcome;
- official offspring descriptors and cost do not drive performance ranking;
- breeding remains probabilistic and advisory only.

## Gate E status

This foundation is **not** a claim that Gate E has been completed.

It supplies deterministic production-domain rules and regression tests for later breeding development. Final non-exploratory breeding recommendations still require the chronological parent-offspring validation, calibration, star-feature comparison, Arena freshness and full rule-engine evidence listed in `REVIEW_GATES.md`.

Until Gate E is satisfied, the website must present outputs from this foundation as research/decision-support evidence rather than a proven offspring-performance model.

## Transaction boundary

The website never initiates a splice, payment, wallet signature or other game transaction.
