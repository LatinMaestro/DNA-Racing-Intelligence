# Analytics Methodology

## Principles

- Historical evidence only for model training and lineage estimates.
- Chronological train/validation/test splits.
- No future leakage.
- Separate bike, car and horse models.
- Exact distance is primary; adjacent-distance and distance-band evidence are supporting features.
- Ignore obsolete race class.
- Show sample size, uncertainty, recency and confidence with every recommendation.
- Keep unlike currencies/assets separate unless a dated explicit conversion is supplied.
- Distinguish source-derived facts, inferred classifications and manual entries.
- Treat Gold and Blue stars as pre-race, field-relative signals rather than guaranteed outcomes or absolute ratings.
- Treat each API publication as a timestamped snapshot, never as guaranteed continuously live game state.

## Core performance features

For each core × mode × distance calculate:

- race count;
- best, median, mean and trimmed-mean time;
- speed equivalents where available;
- standard deviation, interquartile range and robust dispersion;
- percentile distribution;
- exceptional-run rate;
- poor-tail rate;
- rolling recent form;
- historical winning and in-the-money benchmark percentile;
- gate-count and field-strength context where reliable;
- Gold-star and Blue-star profile;
- Gold-star eligibility count;
- field-relative star strength;
- star-data sample size and coverage;
- data-current-through timestamp.

Race distances are measured in metres and Race Merge elapsed-time values are seconds. Preserve the exact source decimal, derive integer milliseconds as `elapsed_time_seconds * 1000`, and derive speed in metres per second as `distance_metres / elapsed_time_seconds`. Lower elapsed time and higher speed remain the better directions; never reinterpret the source seconds as milliseconds.

## Finish-position weighting

- Discovery/open ordinary races: finishing position is secondary.
- Paid qualification: finishing position and in-the-money evidence may receive increased weight.
- Never allow finish position alone to override materially weak time evidence.

## Gold and Blue star methodology

### Confirmed meaning

- Yellow star is sourced from the historical `gold_star` field and means the game assessed that core as having the strongest chance to finish in the top three in the entered field.
- Blue star is sourced from `blue_star` and means the game assessed that core as having the strongest chance to win and finish first in the entered field.
- Stars are assigned before the result and are relative to the particular entered field.

### Confirmed Gold gate rule

- Gold stars are not assigned in races with three gates or fewer.
- Derive `gold_star_eligible = gate_count > 3`.
- Exclude 1-, 2- and 3-gate races from all negative Gold-star evidence and Gold assignment-opportunity denominators.
- A false Gold value in a Gold-ineligible race is structural absence, not evidence against the core.
- Preserve but flag any source Gold assignment at three gates or fewer as a rule anomaly.
- Do not apply this restriction to Blue unless supported by data or a later owner-confirmed rule.

### Basic aggregates

For each core × mode × exact distance calculate, where data permits:

- races with valid star data;
- Gold-eligible races;
- Gold assignment opportunities;
- Blue assignment opportunities;
- Gold count and rate;
- Blue count and rate;
- both-star count and rate;
- Gold-only and Blue-only counts/rates;
- neither-star count and rate where the relevant stars were available;
- rolling star rates;
- rates by gate count, format and period;
- star conversion diagnostics.

Rate outputs must identify whether the denominator is all valid races, Gold-eligible races or only events in which that star type was assigned to someone.

### Pre-race field quality

A star over historically strong entrants is more meaningful than a star over a weak field. Estimate event field quality using only information available before the event start time.

Permitted historical inputs include opponents’ prior:

- mode-distance times and speed distributions;
- successful-time percentiles;
- sample size and confidence;
- star profile;
- recency-weighted form;
- lineage evidence available before the event.

Never use the event’s result, event time, payout or any later race when estimating its pre-race field quality.

### Field-relative star signals

Evaluate:

- strong-field Gold rate using eligible races only;
- strong-field Blue rate;
- stars received over historically elite opponents;
- weak-field eligible no-star rate;
- quality of the opponent receiving the star instead;
- repeated star concentration by mode and distance;
- time/star agreement and disagreement;
- changes in assignment and conversion over time.

A missing or false star is not equivalent to an absolute poor rating. A core can miss because another entrant is stronger, because that star type was not assigned, because Gold was ineligible at the gate count, or because the hidden algorithm changed.

The initial auditable opposition adjustment requires at least 10 pre-event exact-mode-distance races for an opponent quality percentile. Treat 75th percentile as strong, 90th as elite and a fully known field whose strongest opponent is at or below the 50th percentile as weak. Positive assignment weight is zero through the 50th percentile and then increases linearly to one at the 100th percentile. Missing opponent quality remains unknown.

Raw star frequency and raw conversion receive no positive ranking weight. They are displayed as diagnostics. Only the opposition-adjusted assignment evidence may support an elite-racer, Discovery, esports or direct-racer breeding conclusion, and it remains behind materially different time/speed/consistency evidence.

### Predictive use and diagnostics

Stars may be used as historical pre-race features. Outcome-based star conversion is diagnostic only.

Post-race diagnostics may include:

- Gold top-three conversion in Gold-eligible events;
- Blue win conversion;
- Blue in-the-money conversion;
- upset rates;
- non-star winner rates;
- conversion by mode, distance, gate count, format and period.

Prevent any current-event outcome from leaking into the feature used to evaluate that event.

### Algorithm-era analysis

Monitor:

- assignment frequency over time;
- percentage of eligible events with no Gold assignment;
- percentage of events with no Blue assignment;
- conversion changes;
- field-relative behavior changes;
- source schema changes.

Where evidence supports it, segment star features into model eras or effective-date periods rather than treating the hidden game algorithm as permanently stable.

## Discovery model

The shared Horse, Car and Bike normal-Free study supplement is defined in
`DISCOVERY_NORMAL_FREE_STUDY.md`. Its owner-configurable target of twenty usable
normal-Free observations is a test-completion target, not a replacement for the
ten-race minimum analytical boundary below. Evidence classes remain separate;
normal-Free speed/dispersion cannot modify displayed power, adjusted odds or
profile variance.

Candidate hypothesis score should combine:

- direct early time evidence;
- lineage evidence in the confirmed priority order;
- adjacent-distance evidence;
- strength and consistency of successful-time benchmarks;
- early Gold/Blue star evidence;
- Gold eligibility for the observed races;
- field quality when the core received or missed an available star;
- quality of the core receiving the star instead;
- strategic value for upcoming tournaments or vault gaps;
- additional races required to reach 10;
- cost/race conservation considerations.

Use staged testing:

1. initial probe;
2. compare actual times and eligible star evidence to expected competitive distributions;
3. continue, pause or stop;
4. declare minimum evidence only at 10 exact-distance races.

Allow limited exploration outside the expected lineage niche when early times or an unexpected strong-field star indicate a possible exceptional outlier.

A no-star result must not independently cause early stopping. Negative star evidence should reduce priority only where repeated in eligible races and supported by weak times, weak field-relative comparisons or weak lineage evidence.

## Tournament suitability

Translate performance distributions into the metric required by the configured leaderboard.

Examples:

- fastest-time leaderboard: emphasize lower-tail/best-time potential and probability of beating a threshold after N attempts;
- median-time leaderboard: emphasize median and stable distribution;
- Top 2: estimate probability of first or second using historical in-the-money time evidence and field context;
- Double Up: estimate top-half reliability;
- 1v1: pairwise probability against expected or entered opponent;
- points final: simulate multi-race scoring from estimated time/finish distributions.

Use imported historical star evidence as supporting information, particularly where repeated against strong fields, but never replace the configured leaderboard metric with a generic star score.

Do not assume format changes intrinsic performance until an out-of-sample test shows independent predictive value.

## Maiden allocation

For every ME core estimate Bike, Car and Horse Maiden value using:

- strongest exact distances;
- likely qualification metric;
- evidence confidence;
- lineage support;
- strong-field Gold and Blue evidence;
- alternative ME depth in the vault;
- opportunity cost of consuming ME.

Recommend waiting when a future mode has materially stronger projected value.

A limited-sample ME core may receive a stronger provisional recommendation when its time evidence and repeated eligible star assignments over good fields agree. Star evidence must not rescue materially poor time evidence on its own.

## Auto-Entry allocation

Recommend an initial batch and adaptive continuation rule. Do not target 50% gate occupancy.

For fastest-time qualification, estimate diminishing probability of improving the current best time with more attempts.

For median qualification, ensure minimum sample requirements and assess whether additional races are likely to improve or stabilize the median.

Historical star strength may help prioritize which uncertain cores deserve initial attempts, but live field occupancy remains user-managed and is not available from periodic imports.

## Breeding research

Build parent-offspring datasets without future leakage. Test whether offspring performance is predicted by:

- each parent’s mode/distance time profile;
- best, median and variance;
- parent Gold/Blue star profiles by mode and distance;
- parent strong-field star rates;
- star specialization and lineage star-outlier frequency;
- parent asymmetry and complementarity;
- grandparents and wider lineage;
- prior offspring from each parent;
- class pairing;
- element pairing/outcome;
- F-number and generation;
- parent sex/role;
- lineage outlier frequency.

Compare against simple time-only and lineage baselines and report calibration, lift and uncertainty.

Model offspring outcome as a distribution including weaker, comparable, stronger and rare exceptional tails. Never present deterministic inheritance.

Provide separate scores:

- elite-upside score;
- vault-fit/diversification score;
- balanced score.

Vault saturation must not lower elite-upside probability.

Do not assume star propensity is inherited. Include star features only where chronological offspring holdout testing shows genuine additional predictive value.

## Payout inference

Infer payout rules from historical prize distributions where official rules are unavailable.

Store:

- raw label and aliases;
- inferred paid places and proportions;
- effective date range;
- sample size;
- confidence;
- exceptions;
- manual override.

## Data freshness methodology

DNA Open Lab families are synchronized periodically and published only after last-good validation. They are not guaranteed continuously live feeds.

For all race-derived recommendations and reports:

- expose the latest accepted event timestamp as `Data current through`;
- expose successful publication time as `Last synced`;
- calculate data age from the latest event timestamp;
- show a current/ageing/stale label using configurable thresholds;
- show the source sync/publication identity or coverage period where relevant;
- do not describe synchronized opponents, star assignments, arena listings or tournament state as live beyond the applicable freshness contract;
- do not infer that no later game events occurred;
- recalculate only affected aggregates after an idempotent API publication where practical.

Suggested initial thresholds:

- current sync: 0–3 days old;
- ageing: 4–7 days old;
- stale: more than 7 days old.

Freshness affects confidence and user warnings, not the historical facts already accepted.

Analytics that require elapsed time, finishing position, explicit distance or dated historical valuation remain unavailable on the API-only path until an authoritative API contract exposes those facts. Current API dimensions may be shown separately, but they cannot be relabelled as missing historical evidence or leaked backward into backtests.

## Vault economic analytics

### Source hierarchy

For economic reporting use:

1. accepted source-derived race fees and payouts;
2. future authoritative transaction exports;
3. user-entered manual transactions and corrections;
4. inferred tournament/stage classifications, labelled with confidence.

An arena listing is not evidence of completed breeding income.

### Transaction derivation

For each accepted owned-core race entry, derive at most one entry-fee expense and one payout-income transaction for each supported asset. Use a stable source key so cumulative imports cannot duplicate them.

Validate source fee semantics before production import. If it is uncertain whether a field is per-core, per-race or prize-pool information, quarantine the derived amount until confirmed rather than overstating P/L.

### Racing segmentation

Classify race activity into:

- normal open racing;
- tournament qualification;
- automated tournament rounds;
- tournament finals;
- unknown/unclassified.

Classification confidence should reflect the evidence available from event tags, date windows, configured tournament rules, mode, distance, gate count and stage labels.

### Tournament campaign aggregation

For each configured tournament aggregate, by asset/currency:

- qualification entry fees;
- qualification race payouts;
- automated round/final race payouts;
- manual external tournament prizes;
- manually recorded tournament-specific expenses; and
- resulting net campaign cashflow.

Preserve bracket, element/breed/F-number leaderboard and stage attribution where known. Allow vault-level prizes to remain unallocated rather than inventing a per-core split.

### Manual payout analysis

Manual game-owner payouts may be recorded with amount, asset, tournament, date, optional wallet label, core allocation and external reference. Detect possible duplication against race-derived prizes using amount, asset, date window, tournament and reference.

### Multi-currency treatment

Report each asset/currency independently by default.

Optional conversion requires:

- a rate;
- effective date/time;
- rate source;
- original amount; and
- clear estimated/actual status.

Never include BGC in cash/crypto P/L unless the user supplies an explicit valuation and requests a separately labelled converted view.

### BGC analytics

Calculate:

- opening BGC balance, where manually entered;
- BGC earned, including actual recorded burn credits;
- BGC spent, including arena fees paid with BGC;
- net BGC movement; and
- derived balance only where coverage is sufficient.

Do not predict burn-credit value from lifecycle attributes.

### Core trading and cost basis

Calculate realised core-sale result only when acquisition cost and selling fees are known. Otherwise display proceeds and a missing-cost-basis warning.

Where actual breeding costs are linked to a resulting offspring, they may form part of that offspring’s cost basis. Do not infer a market value for unsold cores from current arena listings.

### Completeness status

Every economic report should be classified as complete, partial or estimated based on:

- source date coverage;
- unclassified race activity;
- missing manual external payouts;
- missing acquisition costs;
- missing opening balances;
- duplicate/reconciliation issues; and
- conversion use.

### Economic calculations

Use clearly named metrics:

- Open Racing Net = open payouts minus open entry fees;
- Qualification Net = qualification payouts minus qualification entry fees;
- Tournament Campaign Net = qualification payouts plus round/final payouts plus manual prizes minus qualification fees and recorded campaign expenses;
- Breeding Net Cashflow = breeding fees earned minus DNA and external arena fees paid;
- Core Trading Result = sale proceeds minus known acquisition cost and selling fees;
- Total Recorded Vault Cashflow = recorded operating income minus recorded operating expenses, excluding deposits, withdrawals and internal transfers.

Calculate each metric per asset/currency unless an explicit conversion view is requested.

## Confidence

Use transparent categories such as low, moderate and high based on sample size, recency, consistency, lineage agreement, star-data eligibility/coverage, dataset freshness and out-of-sample validation. Confidence is not the same as predicted quality.

For economic reports, confidence/completeness must reflect source coverage and reconciliation status rather than statistical model certainty.
