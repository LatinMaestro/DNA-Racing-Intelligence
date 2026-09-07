# Discovery Methodology V2 — Cross-Mode Runner Classification

## Purpose

This is the owner-approved Discovery methodology for **Bike, Horse and Car**.
It replaces distance-only or win-rate-only Discovery with a sample-size-aware,
variance-aware and format-aware process whose goal is to identify different
runner types rather than to force every Core into one average-performance score.

The methodology is shared across all three racing modes. Exact distances,
available formats, star semantics and other mode-specific configuration remain
mode authority and must not be copied from Bike into Horse or Car without
explicit authority.

This document does not change Pro League's separate Bike-only eligibility rules.
It governs how Discovery evidence is interpreted and how Discovery testing is
planned.

## Core principle

Discovery asks two different questions:

1. **How good is the Core normally?**
2. **How good can the Core be when it hits its ceiling, and is that ceiling
   repeatable or format-specific?**

A single `+%` central-speed measure cannot answer both questions.

Central pace, ceiling pace, repeatability/variance, sample size, stars,
opposition quality and exact format/gate evidence therefore remain separate
visible axes. They may inform one recommendation, but they must not be silently
collapsed into an opaque score.

## Evidence axes

### 1. Central pace

Use the strongest available same-mode, exact-distance central tendency, normally
median speed or median time, compared with a suitable same-mode/exact-distance
population or competitive benchmark.

Central pace answers whether the Core is consistently fast enough to matter.

### 2. Ceiling pace

Retain best observed speed/time separately from the median.

An elite best time with an ordinary median is not treated as proof of an elite
Core. It is a **ceiling hypothesis** requiring more evidence.

### 3. Repeatability and variance

Where individual times are available, use standard deviation and coefficient of
variation alongside median, mean, best and worst. Where only summary min/max and
median are available, an observed best-to-worst range may be shown as a
**range proxy only**; it must not be labelled statistical variance or standard
deviation.

A wide-range Core can be strategically valuable. It may finish first when it
hits its ceiling and near last when it misses. Discovery must distinguish this
from a repeatable elite Core that produces similar high-level times race after
race.

Wide variance increases the sample-size requirement. It does not automatically
penalise or reject the Core.

### 4. Sample size

Every pace and variance statement is displayed with its sample count.

Tiny samples can identify upside but cannot settle repeatability. The existing
repository minimum analytical boundary remains ten exact-distance races unless a
specific workflow has a different documented authority. The Normal-Free owner
study target remains twenty usable observations under its separate contract.

Low-count elite or high-ceiling Cores stay discoverable; they are not discarded
in favour of average filler merely because another Core has more races.

### 5. Stars

Blue and Yellow/Gold stars are supporting evidence, not substitutes for pace.
Their value depends on opposition quality and the opportunity context.

A star earned over a strong or elite same-mode/exact-distance opponent is much
stronger evidence than a star earned in a weak or unresolved field.

Repeated no-star opportunities can become caution evidence only when:

- the star opportunity is known;
- opposition quality is known;
- the field contains strong or elite relevant opposition; and
- enough such opportunities have accumulated.

No-star evidence alone never authorizes an automatic bench decision.

### 6. Exact format / gate / field evidence

A Core can be ordinary on broad median telemetry yet exceptional in a specific
format, gate size or head-to-head environment. Esports is the clearest current
example, but the principle is mode-independent.

Exact-format performance must therefore remain distinct from ordinary pace.
Examples include:

- 1v1 specialist;
- small-field specialist;
- large-field specialist;
- WTA specialist;
- Madness specialist;
- other future mode-specific format specialisation.

A repeated strong exact-format result can rescue a Core from an otherwise
ordinary central-speed profile and move it into a format-specialist Discovery
class.

### 7. Distance breadth

Once a main distance is settled, broad Discovery volume at that same distance is
wasteful. The Core should leave the pure Discovery roster unless a side-distance
question remains.

Side-distance testing is deliberate. Discovery should determine whether a Core
is:

- a narrow distance specialist;
- useful across adjacent distances within one category;
- useful across two adjacent categories; or
- genuinely broad across short/middle/long structure.

Mode-specific distance bands remain configuration, not universal constants.

## Runner archetypes

The shared domain contract exposes the following runner archetypes.

| Archetype | Meaning | Discovery response |
| --- | --- | --- |
| `repeatable_elite` | Strong/elite central pace with acceptable repeatability | Promote evidence; grow sample only as needed |
| `volatile_elite` | Strong/elite central pace but wide range | Keep testing repeatability and format fit |
| `volatile_ceiling` | Ordinary/weak central pace but strong/elite ceiling | Test whether the ceiling repeats; do not bench early |
| `format_specialist_candidate` | Ordinary central pace but strong star/exact-format support | Target the successful format/gate/distance |
| `high_upside_low_sample` | Strong/elite central or ceiling signal below minimum sample | Grow the exact-distance sample before settling |
| `ordinary` | Adequate sample with no elite central, ceiling or format signal | Enter rule-out workflow rather than immediate bench |
| `unresolved` | Evidence missing or too thin | Gather only the minimum evidence needed to classify |

These archetypes describe evidence. They are not permanent labels and can change
as the sample grows.

## Discovery classes

### `promote`

Use when a Core has repeatable-elite evidence or high-upside low-sample evidence.
The Core remains in Discovery until the relevant sample is strong enough to
move it into competition/settled status.

### `confirm_side_distance`

Use when the main distance is already sufficiently understood but an adjacent
distance/category question remains. Do not spend Discovery volume repeating an
already-settled main-distance result.

### `variance_format`

Use for volatile elite, volatile ceiling or format-specialist candidates.
Testing should focus on repeatability, the exact successful format/gate and the
relevant adjacent distances rather than broad random volume.

### `rule_out`

Use before benching an apparently ordinary Core. Rule-out is a test plan, not a
verdict.

A Core being considered for rejection should be tested across **two adjacent
distance categories** where mode configuration allows it. For a short anchor,
use short + middle. For a long anchor, use middle + long. For a middle anchor,
select the short or long adjacent category with the stronger remaining evidence
or unresolved upside.

The target is to establish that the Core is not merely being tested at the
wrong distance/category.

### `settled`

Use when the main performance profile is already sufficiently understood and no
side-distance question remains. Settled Cores should normally be excluded from a
pure Discovery roster to preserve ageing and Discovery capacity.

## Pure Discovery roster construction

A pure Discovery roster is **not** the best competitive roster.

Roster slots are allocated to unresolved questions, not to average performance
fillers. Prefer:

- small-sample elite pace;
- elite ceiling requiring repeatability evidence;
- promising adjacent-distance hypotheses;
- strong exact-format signals;
- variance profiles that could hide first-place upside; and
- final rule-out candidates that still need proper two-category testing.

Exclude settled elite Cores unless a side-distance question is still open.

When a game mode imposes roster composition constraints, satisfy those
constraints with the strongest unresolved candidates available rather than
known-average filler.

## Mapping Discovery races

Discovery mapping should maximize information per ageing race.

- **1v1 / small fields:** isolate candidates and test ceiling/repeatability or a
  suspected specialist role.
- **Medium fields:** build exact-format samples and compare against meaningful
  opposition.
- **Large fields:** build volume and opposition exposure, but do not let large
  fields alone determine promotion because field noise is higher.
- **Early-map weighting:** where a match may end before all races are reached,
  place the highest-priority unresolved questions earlier.
- **Settled Cores:** do not use simply to make the Discovery team more likely to
  win.

Competition and Discovery rosters remain different products.

## Variance interpretation

A Core with a wide range can have several possible identities:

1. genuinely volatile elite;
2. elite ceiling but ordinary typical result;
3. format specialist whose good outcomes cluster in one gate/format;
4. low-sample artefact;
5. genuinely ordinary Core with one outlier.

The distinction requires sample growth. As the sample grows:

- if median remains elite and spread stays wide, treat as volatile elite;
- if median stays ordinary but elite best performances repeat in a specific
  format, treat as a format/ceiling specialist candidate;
- if the elite best never repeats and star/format evidence does not appear,
  downgrade the ceiling hypothesis;
- if times become tight around an elite median, promote as repeatable elite;
- if times become tight around an ordinary/weak median after two-category
  rule-out testing, benching becomes reasonable.

## No-star interpretation

No Blue/Yellow/Gold stars are never interpreted without opportunity context.

A lack of stars can support caution only after repeated quality-known
opportunities against strong/elite opposition. It remains one evidence axis and
cannot automatically override elite pace or an elite ceiling.

Conversely, repeated Blue/Yellow/Gold stars over elite opposition can justify
continued Discovery even when median telemetry is ordinary. This creates a
`variance_format` question that should be resolved with targeted exact-format
racing rather than broad random testing.

## Cross-mode requirements

This methodology applies identically to:

- Bike;
- Horse; and
- Car.

The shared code must always carry `mode` on evidence and recommendations.

Do not assume the following are identical across modes:

- supported exact distances;
- short/middle/long band boundaries;
- available gate/field structures;
- star availability or semantics;
- tournament eligibility;
- ageing behaviour;
- format names; or
- population benchmarks.

Each mode requires its own authoritative configuration. The methodology consumes
that configuration; it does not invent it.

## Website integration contract

Future Discovery UI should expose at minimum:

- mode selector: Bike / Horse / Car;
- Discovery class;
- runner archetype by exact distance;
- median/central pace and benchmark standing;
- best/ceiling pace separately;
- sample count;
- standard deviation/CV when raw observations allow it;
- observed range clearly labelled as a proxy when only min/max are available;
- star evidence with opposition quality;
- exact-format/gate evidence;
- current main distance hypothesis;
- side-distance questions;
- recommended two-band rule-out plan where applicable;
- reason a settled Core is excluded from pure Discovery; and
- owner-facing graduation / continue / bench review state.

The UI must not display an opaque one-number "Discovery score" as the sole
explanation for a decision.

## Automation boundary

The methodology may recommend where to test next, but it does not authorize:

- automatic race entry;
- automatic promotion to a competition roster;
- automatic benching;
- automatic spending;
- provider writes; or
- deployment.

The shared domain contract deliberately exposes `automaticPromotionAllowed:
false` and `automaticBenchAllowed: false`.

## Repository implementation

The shared implementation lives in `domain/discovery-methodology.ts`.

It is intentionally mode-agnostic and consumes
`DiscoveryModeDistanceConfiguration`. This allows Bike to use its current
owner-reviewed distance configuration while Horse and Car can adopt the same
logic once their own exact-distance configurations are authoritative.

The existing Normal-Free study, probe plan, benchmark, star and decision-guidance
contracts remain valid evidence producers. This methodology sits above them as
the classification and test-planning layer.
