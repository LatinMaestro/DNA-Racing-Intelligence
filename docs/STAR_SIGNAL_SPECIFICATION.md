# Gold and Blue Star Signal Specification

## 1. Purpose

DNA Racing race exports contain pre-race star indicators that may expose useful information about the game’s hidden assessment of the cores entered in a field.

The website must preserve and analyse these signals as first-class race-entry data.

The owner-confirmed meanings are:

- **Gold star**: the core assessed by the game as having the strongest chance to finish in the top three in that race field.
- **Blue star**: the core assessed by the game as having the strongest chance to win the race and finish first.

The Race Merge export fields are `gold_star` and `blue_star`. The application must use the same user-facing terminology: **Gold star** and **Blue star**.

A star is a field-relative pre-race signal. It is not a guarantee of the eventual outcome and it is not an absolute core rating.

## 2. Confirmed gate rule

Gold stars are not assigned in races with three gates or fewer.

Therefore:

- a core must never be penalised for lacking a Gold star in a 1-, 2- or 3-gate race;
- races with three gates or fewer are ineligible for the Gold-star assignment-opportunity denominator;
- a `false` Gold-star value in a race with three gates or fewer means **not eligible for assignment**, not a negative assessment;
- the importer and analytics layer must derive and expose `gold_star_eligible = gate_count > 3` unless future owner-confirmed rules change;
- if source data marks a Gold star in a race with three gates or fewer, retain the source value but flag a rule anomaly for review;
- Blue-star analysis remains separate and must not inherit the Gold-star gate restriction unless supported by source data or a later confirmed rule.

## 3. Strategic value

Historical star assignments may be valuable because they can provide evidence beyond raw finishing positions:

- receiving a Gold or Blue star over historically strong opposing cores is a promising signal;
- repeatedly receiving stars at a particular mode and distance may support a specialist hypothesis;
- receiving stars with a small direct race sample may justify continued targeted Discovery;
- failing to receive an eligible star against a weak field may be a negative signal;
- repeatedly losing the star to poor or average opponents may indicate that the core is weaker in that condition than its raw results suggest;
- star behaviour may provide a proxy for hidden racing qualities that are not otherwise exported.

The inverse signal must be interpreted carefully. A core can miss a star because one other entrant is stronger, because that star type was not assigned in the event, because the event was ineligible for Gold under the gate rule, or because the game’s star algorithm changed. Absence of a star is therefore supporting negative evidence, not automatic proof that the core is poor.

## 4. Source fields and import behaviour

Expected source fields in Race Merge exports:

- `gold_star` — source Boolean for the Gold star;
- `blue_star` — source Boolean for the Blue star.

The importer must:

- preserve the raw source values;
- normalize them into nullable Boolean fields without renaming Gold to another colour;
- distinguish `false` from missing, unknown or malformed values;
- retain import-batch and source-column provenance;
- never convert a missing field into `false` silently;
- derive Gold-star eligibility from gate count;
- validate whether more than one core is marked with the same star type in one event;
- validate the confirmed no-Gold-at-three-gates-or-fewer rule;
- retain anomalous source data with a warning rather than rewriting it silently.

Initial supplied exports contain both fields as Booleans and historical inspection indicates no more than one Gold and one Blue star per event. This observation must be validated during every import and must not be hardcoded as an unchangeable rule beyond the owner-confirmed gate rule.

## 5. Proposed database representation

### 5.1 Raw race-entry fields

Each normalized race-entry record should include at least:

- `gold_star` nullable Boolean;
- `blue_star` nullable Boolean;
- `gold_star_eligible` Boolean or derivable field;
- `gold_star_source_value` optional raw value;
- `blue_star_source_value` optional raw value;
- `star_data_status` such as `complete`, `partial`, `missing` or `invalid`;
- source import-batch reference.

The raw/staging table may retain the exact source columns, while the normalized table retains typed values and validation status.

### 5.2 Event-level assignment

The system should derive event-level records or views for:

- gate count;
- Gold-star eligibility;
- whether a Gold star was assigned in the event;
- Gold-star core ID where assigned;
- whether a Blue star was assigned in the event;
- Blue-star core ID where assigned;
- whether the same core received both;
- validation status and anomaly warnings.

### 5.3 Core star-profile aggregates

For each core × mode × exact distance, and for useful broader groupings, calculate:

- total races with valid star data;
- Gold-eligible races;
- races in which a Gold star was actually assigned;
- races in which a Blue star was available for assignment;
- Gold-star count and rate;
- Blue-star count and rate;
- both-stars count and rate;
- Gold-only count and rate;
- Blue-only count and rate;
- neither-star count and rate where both were genuinely available;
- recent rolling star rates;
- star rates by gate count and relevant race format;
- star rates by field-quality band;
- sample size and confidence.

Store or expose denominators clearly:

1. **all races with valid star data**;
2. **Gold-eligible races** with more than three gates;
3. **assignment-opportunity races** where that star type was assigned to someone.

Do not use 1–3 gate races in a negative Gold-star denominator.

## 6. Field-relative analysis

A star over an elite field is more meaningful than a star over a poor field. The system must estimate the quality of the opposing entrants and the strength of the star assignment.

### 6.1 Pre-race field quality

For each historical event, estimate field quality using only information that would have existed before the event start time. Candidate inputs include:

- each opponent’s prior mode-distance race-time distribution;
- prior successful-time percentile;
- prior Gold and Blue star profile;
- prior sample size and confidence;
- lineage evidence available before the event;
- recency-weighted prior form.

Do not use the current event’s result, time, finishing position, prize or later races when calculating its pre-race field quality.

### 6.2 Derived field-relative signals

Potential derived metrics include:

- **strong-field Gold rate** — frequency of receiving Gold in eligible fields above a defined quality percentile;
- **strong-field Blue rate** — frequency of receiving Blue in fields above a defined quality percentile;
- **elite-opponent star wins** — occasions where the core received a star over one or more historically elite entrants;
- **weak-field eligible no-star rate** — frequency of receiving neither available star in historically weak fields, excluding Gold-ineligible events;
- **star displacement quality** — quality of the core that received the star instead;
- **field-relative star index** — normalized strength of historical star assignments after accounting for opponent quality;
- **star consistency** — whether the signal is repeated across comparable conditions;
- **star specialization** — concentration of the signal in one mode, distance or distance band.

Names and formulas must remain explainable. Avoid a single opaque score without showing the underlying evidence.

## 7. Discovery use

Star evidence is especially useful for under-tested cores.

### 7.1 Positive Discovery evidence

Increase the priority of a mode-distance Discovery hypothesis where a core:

- receives a Gold or Blue star in its early races;
- repeatedly receives stars before reaching the 10-race minimum sample;
- receives a star over established strong cores;
- shows star concentration at one exact distance or adjacent distance band;
- receives stars despite an otherwise unimpressive finishing record caused by difficult fields;
- has direct time evidence that agrees with the star signal.

### 7.2 Negative Discovery evidence

Reduce the priority, or consider early stopping, where a core:

- repeatedly receives no available star in eligible weak fields;
- loses the relevant star to historically poor or average opponents;
- has weak race times as well as weak star evidence;
- has no supporting star or time evidence from its relevant lineage.

A no-star result must not be used alone to stop Discovery. Direct time evidence remains primary, and the model must account for who received the star instead and whether Gold was eligible at that gate count.

### 7.3 Unexpected specialists

A star at an unexpected mode or distance may justify a controlled probe even where lineage predicted another specialty. This supports detection of rare outlier or “supernatural” racing performance without randomly testing every condition.

## 8. Whole-core analysis

Core profiles should show star evidence separately for Bike, Car and Horse and for exact distances.

Recommended profile outputs:

- overall historical Gold and Blue assignment rates;
- Gold-eligible race count;
- mode-specific rates;
- exact-distance rates;
- strongest star-supported niche;
- strongest field over which the core received each star;
- star evidence trend over time;
- star evidence before and after the core reached a meaningful sample;
- mismatch warnings where times and stars disagree;
- comparison with parents, grandparents, siblings and offspring;
- explanation of whether star evidence strengthens or weakens the current lifecycle recommendation.

A core must not be described as a strong all-mode racer merely because it receives stars in one mode.

## 9. Tournament and Maiden use

Historical star evidence can support tournament qualification and Maiden selection, particularly where direct race samples are limited.

Examples:

- repeated Blue stars at Horse 1600 may support fastest-time or win-focused qualification suitability;
- repeated Gold stars with stable times may support Top 2, Top 3 or consistency-oriented qualification;
- an ME core receiving stars over strong ordinary-race fields may justify committing it to that mode’s Maiden;
- an ME core that cannot receive an available star over weak entrants in one mode may be better preserved for another mode.

Star evidence does not replace the tournament’s actual leaderboard metric. Fastest-time qualification remains primarily about best-time potential, while median-time qualification remains primarily about a low and stable median elapsed time.

The website is not a live-data application. Historical star evidence reflects the latest imported race export only.

If current race stars are visible to the user, the optional Open Race tool may allow manual entry of Gold and Blue assignments. Do not assume the website can fetch them from the authenticated game or that a historical import represents the current open field.

## 10. Lineage and breeding research

Historical star propensity may be investigated as a lineage feature because it may proxy hidden racing qualities.

Breeding research may test whether offspring quality is associated with:

- parent Gold-star and Blue-star rates by mode and distance;
- strong-field star rates;
- star specialization;
- parent agreement or complementarity;
- grandparents and prior offspring star profiles;
- frequency of exceptional star-supported descendants.

Do not assume star propensity is genetically inherited. It must be tested chronologically against offspring holdout data and compared with time-only baselines.

The breeding optimiser should report whether star features add validated predictive lift. It must not claim that stars reveal the secret breeding formula.

## 11. Outcome diagnostics versus predictive features

Stars are assigned before a race and may be used as historical pre-race evidence. Outcomes occur after the assignment.

Post-race diagnostic measures may include:

- Gold-star top-three conversion rate;
- Blue-star win conversion rate;
- Blue-star in-the-money conversion rate;
- star upset frequency;
- non-star winner frequency;
- conversion by mode, distance, gate count and period.

Gold conversion diagnostics must exclude races with three gates or fewer from any eligible-opportunity comparison.

These diagnostics are useful for assessing how reliable the game’s star system is. They must not be allowed to leak the current race outcome into a pre-race feature.

## 12. Data refresh and freshness

The website will receive a newer Race Merge export approximately once every few days. It will not operate from live game data.

The system must:

- store import timestamp, source filename, checksum and latest event timestamp;
- display **Data current through** using the latest accepted race event date/time;
- display **Last imported** separately;
- calculate and show data age;
- label race-derived views as imported historical snapshots;
- show a stale-data warning once a configurable threshold is exceeded;
- never call imported fields, opponents, arena state or recommendations “live”;
- not infer that races after the latest imported event are absent from the game;
- allow newer cumulative imports to update results idempotently;
- recalculate affected star aggregates after each accepted import.

Suggested default freshness labels, configurable later:

- **Current import**: latest event is 0–3 days old;
- **Ageing**: 4–7 days old;
- **Stale**: more than 7 days old.

These labels describe the imported dataset only, not the state of the live game.

## 13. Time variation and algorithm changes

The game’s star-assignment algorithm may change over time.

The system must:

- calculate star profiles by time period;
- detect material changes in assignment frequency or conversion;
- retain effective-date or model-era segmentation where supported;
- avoid assuming that old star behaviour remains equally predictive;
- display recency and coverage;
- permit manual notes for known game changes.

## 14. User interface requirements

### Core profile

Display:

- Gold-star and Blue-star rates;
- raw counts and denominators;
- Gold-eligible race count;
- both-star rate;
- strongest mode-distance star profile;
- strong-field star evidence;
- weak-field eligible no-star warning where statistically supported;
- trend and confidence;
- data-current-through timestamp;
- concise explanation.

### Discovery

Each Discovery card may include:

- early star evidence;
- quality of fields in which stars were received or missed;
- Gold eligibility for the relevant race samples;
- agreement with race-time evidence;
- influence on continue, pause or stop recommendation;
- data freshness.

### Tournament and Maiden optimiser

Show imported historical star evidence as supporting rationale, not as the sole ranking basis or live tournament state.

### Open Race

Allow optional manual selection of the currently displayed Gold- and Blue-star cores if that information is available to the user.

## 15. Validation and tests

Automated tests must cover:

- raw and normalized `gold_star` handling;
- `blue_star` handling;
- nullable Boolean handling;
- distinction between missing and false;
- `gold_star_eligible = false` for gate count 1–3;
- exclusion of 1–3 gate races from negative Gold denominators;
- anomaly warning where source Gold is true at gate count 3 or fewer;
- event-level uniqueness validation;
- same-core-both-stars support;
- denominator correctness;
- strong-field metrics using pre-event information only;
- chronological no-leakage tests;
- mode and distance separation;
- star aggregates across cumulative import deduplication;
- freshness timestamp and stale-state calculations;
- no UI or API wording that presents imported race data as live;
- algorithm-era segmentation;
- Discovery explanations for positive and negative star evidence;
- no-star evidence never becoming an automatic burn or stop decision by itself.

## 16. Analytical cautions

- A star is relative to the entered field.
- Gold is unavailable in races with three gates or fewer.
- Missing an eligible star does not mean the core is objectively poor.
- Receiving a star does not guarantee winning or placing.
- The star algorithm is hidden and may incorporate unknown variables.
- Stars may be absent in some eligible events.
- Historical fields may contain discovery cores entered at unsuitable distances.
- Current-event outcomes must not be used to define pre-race field strength.
- Imported data is periodic and historical, not live.
- Star evidence must be combined with race times, speed, sample size, lineage and tournament objective.

## 17. Definition of successful implementation

The feature is successfully implemented when the system can:

- import and preserve Gold and Blue star flags without ambiguity;
- correctly treat 1–3 gate races as Gold-ineligible;
- show auditable core-level star profiles by mode and distance;
- identify stars earned over strong fields;
- identify repeated eligible no-star results in weak fields without over-penalising isolated cases;
- incorporate star evidence into targeted Discovery;
- use star evidence as a supporting tournament, Maiden, breeding and lifecycle feature;
- display data freshness and avoid live-data claims;
- validate predictive value chronologically; and
- explain every star-derived conclusion with counts, eligibility, field context, freshness and uncertainty.
