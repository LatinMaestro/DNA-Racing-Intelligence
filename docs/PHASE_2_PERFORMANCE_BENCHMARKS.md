# Phase 2 Performance Benchmark Contract

## Scope

This slice creates transparent historical elapsed-time benchmarks from validated
normalized race observations. It does not train a recommendation model or claim
predictive success.

## Exact context

Benchmarks remain separate by:

- Bike, Car or Horse mode;
- exact distance in metres;
- exact gate count; and
- the preserved historical format label, where present.

The format label is context only. This contract does not assume that payout or
race format changes a core's intrinsic performance.

Each benchmark exposes the entry and event counts, historical data cutoff, and
the fastest, 10th, 25th, median, 75th, 90th and slowest elapsed times. Lower
elapsed time remains better.

## Outcome coverage

Winner and in-the-money benchmarks require complete event evidence.

- A complete event must contain the stated number of gates and exactly one
  first-place row.
- Partial event rows can contribute validated elapsed-time evidence but cannot
  create winner or in-the-money distributions.
- In-the-money status is explicit `yes`, `no` or `unknown`. It is not inferred
  from finishing position because payout mechanisms can differ.
- Known, unknown and positive in-the-money counts are exposed separately.

Malformed, duplicate or context-conflicting observations fail closed rather than
being silently merged.

## Percentile direction

The helper percentile reports the percentage of historical comparison times that
the candidate equals or beats. This gives the user-facing metric a transparent
higher-is-better direction while retaining elapsed milliseconds as the
authoritative lower-is-better evidence.

## Boundaries

All outputs remain `experimental` until Gate C chronological holdout, baseline,
calibration and no-leakage evidence passes. This contract:

- does not use current-event results as pre-race features;
- does not combine modes, distances, gate counts or format labels;
- does not make imported data live;
- does not interpret a payout label as a monetary amount;
- does not create a recommendation; and
- uses synthetic fixtures only.

## Validation

Synthetic tests cover exact-context separation, quantiles, explicit
in-the-money coverage, partial-event outcome exclusion, higher-is-better
percentile direction, malformed and duplicate rejection, event-context
conflicts, blank format handling and deterministic ordering.

Focused hosted-workspace validation passes repository-pinned Prettier, strict
TypeScript and all seven synthetic tests. Mandatory full exact-head GitHub CI and
merge remain deferred while hosted runners are unavailable.
