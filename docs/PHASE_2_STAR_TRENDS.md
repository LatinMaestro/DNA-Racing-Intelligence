# Phase 2 Star Trend and Change-Candidate Contract

## Scope

This slice provides descriptive Gold and Blue assignment-frequency trends for
configured historical periods. It supports investigation of possible hidden
star-algorithm changes without declaring an algorithm era from synthetic or
insufficient evidence.

## Evidence boundary

The input contains validated event-level assignment states only:

- `assigned`;
- `not_assigned`; or
- `excluded`.

It intentionally contains no finishing position, elapsed time, prize or future
race field. The trend calculation therefore cannot leak outcomes into historical
assignment-frequency evidence.

Gold and Blue remain independent. Gold-ineligible events must carry an excluded
Gold state and never enter its assignment-opportunity denominator. Missing,
invalid or ambiguous evidence remains excluded rather than becoming a negative
assignment.

## Period summaries

Periods are explicit, ordered, non-overlapping, start-inclusive and
end-exclusive. Each summary remains separate by mode and exact distance and
exposes:

- total event count;
- Gold-eligible and Gold-ineligible event counts;
- assigned, no-assignment and excluded counts for each signal;
- the exact opportunity denominator;
- assignment rate where a denominator exists; and
- `descriptive_experimental` status.

Events outside configured periods are counted separately rather than silently
dropped.

## Change candidates

Adjacent configured periods are compared only when both have the configured
minimum opportunity count. The absolute rate-change threshold is supplied by the
caller and is not treated as an official game rule.

Every result is one of:

- `insufficient_evidence`;
- `stable_within_threshold`; or
- `change_candidate`.

A change candidate is descriptive only. It is not a confirmed algorithm era,
causal finding or dependable predictive feature. Gate C and Phase 9 must provide
chronological stability, baseline and predictive-lift evidence before a detected
era affects actionable recommendations.

## Validation

Synthetic tests cover exact mode-distance separation, independent Gold and Blue
denominators, strict Gold eligibility, excluded evidence, configurable rate
shifts, minimum sample enforcement, boundary timestamps, outside-period
coverage, invalid periods, duplicate events and deterministic ordering.

Focused hosted-workspace validation passes repository-pinned Prettier, strict
TypeScript and all seven synthetic tests. Mandatory full exact-head GitHub CI and
merge remain deferred while hosted runners are unavailable.
