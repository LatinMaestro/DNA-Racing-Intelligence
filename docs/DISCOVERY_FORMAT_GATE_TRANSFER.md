# Discovery Format/Gate Transfer Inference

## Purpose

This document extends `DISCOVERY_METHODOLOGY_V2.md` for Bike, Horse and Car.

A Core does not need direct starts in every format/gate cell before Discovery can form a useful hypothesis about that cell. A Core's same-mode, exact-distance speed distribution and repeatability profile can be compared with the distributions of the top-performing Cores in a target format/gate cohort.

The result is **transfer-fit evidence**. It is an inference used to choose where to test next. It is not proof that the Core is already a format specialist.

## Two evidence lanes

Discovery keeps two format lanes separate:

1. **Direct format/gate evidence** — the Core has raced the exact mode + distance + format + gate/field structure.
2. **Transfer-fit evidence** — the Core has not yet built a direct sample, but its same-mode/exact-distance central pace, ceiling and dispersion match or exceed the distribution of elite performers in that format/gate cohort.

Direct evidence takes precedence once a useful exact-format sample exists. Transfer evidence remains useful for explaining why the Core was targeted in that cell.

## Benchmark construction

A target format/gate benchmark is built independently for:

- racing mode;
- exact distance;
- exact format identifier;
- exact gate/field size; and
- a configured outcome/ranking metric appropriate to that format.

Examples of ranking metrics include:

- winning outcome for 1v1 or WTA;
- top-three outcome for Madness where top-three performance is the relevant success condition;
- successful speed/time when that is the configured competition metric; or
- another explicitly configured format metric.

The benchmark must record the percentile floor used to define the elite cohort rather than silently assuming a universal threshold. For example, a study may define the top 10% of Cores in 1600 m 6-gate Madness as the comparison cohort, while another format may require a different threshold.

For the elite cohort, retain distributions for:

- central speed, normally the Core's exact-distance median or comparable central measure;
- ceiling speed, normally the best valid exact-distance observation; and
- dispersion/repeatability where authoritative observations permit it.

The current domain contract stores p25, median and p75 of the elite cohort for each of those axes. Sample size, source authority and data-current-through timestamp remain visible.

## Candidate transfer comparison

For a candidate Core at the same mode and exact distance:

### Central fit

Compare the candidate's central speed with the elite format cohort:

- at or above the elite cohort median: strong central match;
- between elite p25 and median: lower-quartile elite match;
- below elite p25: central pace does not currently match the elite format cohort.

### Ceiling fit

Apply the same comparison to best/ceiling speed.

This is particularly important for volatile Cores. A Core may have an ordinary median but repeatedly reach speeds that equal or exceed elite 1v1 or WTA winners. That creates a plausible ceiling-format hypothesis even before direct starts in that exact format.

### Dispersion fit

Dispersion must use the same metric on both sides of the comparison.

Where full observations exist, coefficient of variation is preferred. Where only min/max/median summaries exist, a normalized range may be used only as a clearly labelled **range proxy**.

The candidate is described as:

- tighter than the elite cohort;
- within the elite cohort's p25-p75 dispersion band;
- wider than the elite cohort; or
- unavailable.

Tighter is not automatically better and wider is not automatically worse. The point is to compare the candidate's distribution shape with the distribution shape that actually succeeds in the target format.

For example, if elite performers in a format are themselves volatile, a similarly volatile candidate with elite ceiling speed may be a better transfer-fit than a merely average, low-variance Core.

## Transfer assessments

The shared domain layer exposes these inference states:

| Assessment | Meaning | Discovery response |
| --- | --- | --- |
| `strong_inferred_fit` | Candidate central and ceiling pace both reach the elite format cohort | Prioritise a targeted direct-format probe |
| `ceiling_inferred_fit` | Central pace is weaker but ceiling reaches the elite cohort | Test for a volatile/first-place specialist role |
| `central_inferred_fit` | Central pace reaches elite median but ceiling evidence is weaker | Test for repeatable/top-three style usefulness |
| `mismatch` | Candidate does not currently reach the elite cohort on central or ceiling evidence | Do not prioritise that format from transfer evidence alone |
| `unavailable` | Candidate distribution or benchmark is unavailable | Gather the missing evidence first |

Every transfer result is explicitly `inferenceOnly: true` and `provenFormatSpecialist: false`.

## Sample-size handling

The candidate's exact-distance sample and the benchmark cohort size both affect confidence.

The initial shared confidence convention is:

- **high**: candidate has at least 10 usable exact-distance observations and benchmark has at least 50 Cores;
- **moderate**: candidate has at least 5 observations and benchmark has at least 20 Cores;
- **low**: below those boundaries.

These are confidence labels, not automatic promotion thresholds.

Low-count elite-looking Cores remain valid Discovery candidates. A low confidence label means the direct format probe is more important, not that the opportunity should be discarded.

## Relationship to direct format evidence

Transfer inference exists to discover untested specialisation.

If a Core already has at least the configured minimum direct format sample, the direct lane becomes the primary decision evidence. The transfer profile remains explanatory context only.

The domain contract defaults the useful direct-format boundary to five starts for deciding whether to prefer direct evidence. This does **not** replace the repository's separate ten-race analytical boundary for settled conclusions.

## Stars and opposition

Transfer-fit evidence and star evidence are separate axes.

A candidate can be targeted because its speed/variance distribution matches elite performers even before it receives a star in that format. Later Blue/Yellow/Gold assignments over strong or elite opposition can strengthen the hypothesis.

Conversely, no-star evidence does not invalidate transfer fit unless repeated relevant opportunities and opposition quality are known, under the main Discovery methodology.

## No future leakage

Format/gate cohort construction must use only evidence that would have been available at the evaluation cutoff.

For chronological backtests or pre-event recommendations:

- do not use a candidate's later races to build its earlier transfer profile;
- do not use later opponent results to define the earlier elite cohort;
- do not use the outcome of the race being predicted in its own benchmark; and
- retain data-current-through timestamps for candidate and benchmark evidence.

## Cross-mode boundary

This logic applies to Bike, Horse and Car.

It does not assume that those modes share:

- distances;
- formats;
- gate structures;
- success metrics;
- dispersion patterns; or
- elite percentile thresholds.

Each format/gate benchmark must be built within the same mode and exact distance under that mode's authoritative configuration.

## Website integration

Future Discovery and roster-selection pages should be able to display an **Inferred Format Fit** panel even when direct format starts are zero.

At minimum show:

- mode, exact distance, format and gate count;
- direct format race count;
- elite-cohort definition and sample size;
- candidate central speed versus elite cohort p25/median/p75;
- candidate ceiling speed versus elite cohort p25/median/p75;
- candidate dispersion versus elite cohort dispersion;
- confidence;
- transfer assessment;
- whether direct evidence now supersedes the inference; and
- the recommended targeted probe.

UI language must distinguish **inferred fit** from **proven format performance**.

## Implementation

The shared implementation lives in `domain/discovery-format-gate-transfer.ts`.

It is intentionally mode-agnostic and does not contain Bike-specific format names or distance values. The format/gate benchmark producer can later consume the authoritative Esports/API history and the same pattern can be used for Horse and Car when their mode-specific evidence becomes available.
