# Analytics Methodology

## Principles

- Historical evidence only for model training and lineage estimates.
- Chronological train/validation/test splits.
- No future leakage.
- Separate bike, car and horse models.
- Exact distance is primary; adjacent-distance and distance-band evidence are supporting features.
- Ignore obsolete race class.
- Show sample size, uncertainty, recency and confidence with every recommendation.

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
- gate-count and field-strength context where reliable.

Normalize elapsed-time metrics so higher displayed scores always mean better performance.

## Finish-position weighting

- Discovery/open ordinary races: finishing position is secondary.
- Paid qualification: finishing position and in-the-money evidence may receive increased weight.
- Never allow finish position alone to override materially weak time evidence.

## Discovery model

Candidate hypothesis score should combine:

- direct early time evidence;
- lineage evidence in the confirmed priority order;
- adjacent-distance evidence;
- strength and consistency of successful-time benchmarks;
- strategic value for upcoming tournaments or vault gaps;
- additional races required to reach 10;
- cost/race conservation considerations.

Use staged testing:

1. initial probe;
2. compare actual times to expected competitive distribution;
3. continue, pause or stop;
4. declare minimum evidence only at 10 exact-distance races.

Allow limited exploration outside the expected lineage niche when early times indicate a possible exceptional outlier.

## Tournament suitability

Translate performance distributions into the metric required by the configured leaderboard.

Examples:

- fastest-time leaderboard: emphasize lower-tail/best-time potential and probability of beating a threshold after N attempts;
- median-time leaderboard: emphasize median and stable distribution;
- Top 2: estimate probability of first or second using historical in-the-money time evidence and field context;
- Double Up: estimate top-half reliability;
- 1v1: pairwise probability against expected or entered opponent;
- points final: simulate multi-race scoring from estimated time/finish distributions.

Do not assume format changes intrinsic performance until an out-of-sample test shows independent predictive value.

## Maiden allocation

For every ME core estimate Bike, Car and Horse Maiden value using:

- strongest exact distances;
- likely qualification metric;
- evidence confidence;
- lineage support;
- alternative ME depth in the vault;
- opportunity cost of consuming ME.

Recommend waiting when a future mode has materially stronger projected value.

## Auto-Entry allocation

Recommend an initial batch and adaptive continuation rule. Do not target 50% gate occupancy.

For fastest-time qualification, estimate diminishing probability of improving the current best time with more attempts.

For median qualification, ensure minimum sample requirements and assess whether additional races are likely to improve or stabilize the median.

## Breeding research

Build parent-offspring datasets without future leakage. Test whether offspring performance is predicted by:

- each parent’s mode/distance time profile;
- best, median and variance;
- parent asymmetry and complementarity;
- grandparents and wider lineage;
- prior offspring from each parent;
- class pairing;
- element pairing/outcome;
- F-number and generation;
- parent sex/role;
- lineage outlier frequency.

Compare against simple baselines and report calibration, lift and uncertainty.

Model offspring outcome as a distribution including weaker, comparable, stronger and rare exceptional tails. Never present deterministic inheritance.

Provide separate scores:

- elite-upside score;
- vault-fit/diversification score;
- balanced score.

Vault saturation must not lower elite-upside probability.

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

## Confidence

Use transparent categories such as low, moderate and high based on sample size, recency, consistency, lineage agreement and out-of-sample validation. Confidence is not the same as predicted quality.
