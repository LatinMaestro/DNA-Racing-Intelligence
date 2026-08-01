# Phase 9 Private Chronological Evidence Contract

Status: synthetic contract only; recommendation gates remain closed

## Scope

This contract defines how private hosted chronological evidence may be assessed
without committing any private export, row, identity, economic value, exact
aggregate, model score or derived private result to Git.

The repository contains only validation logic, synthetic fixtures and the
non-actionable gate semantics. Real evidence remains in the approved private
hosted boundary and must be referenced through a non-secret immutable evidence
identifier and exact 40-character source head.

## Chronology and outcome safeguards

An assessment is usable only when:

- source and unique-row/duplicate counts reconcile without integer overflow;
- complete and partial event counts reconcile;
- evidence is externally ordered rather than trusting file order;
- every feature cutoff is strictly before the target event;
- all predictions for one event are fixed before same-event history updates;
- partial events are excluded from winner, Top-X, conversion and holdout
  outcomes;
- baselines remain separate by mode, exact distance in metres and gate count;
  and
- direct-history, historical-star and lineage results each bind their own
  non-zero eligible case count.

Positive lift creates a review candidate only. Zero or negative lift is not
supported. No metric, threshold crossing or owner-supplied label can
self-accept Gate C or activate a recommendation.

## Missing historical state

Breeding evidence remains blocked without breeding timestamps and
prediction-at-breeding records. Maiden evidence remains blocked without
point-in-time entitlement history. A current replacement Vault snapshot must
never be projected backwards.

Era threshold crossings are review signals only. They do not prove a hidden
algorithm change, identify causality or authorize automatic segmentation.

## Capacity and economics

Representative capacity requires a non-synthetic approved evidence source,
at least three repeated full scans, bounded positive memory evidence and
off-request-path execution. It remains separate from deployed routine-request
latency.

Historical BGC evidence satisfies this contract only when at least one
historical BGC row is observed, no historical BGC race creates a race-ledger
transaction and no unknown race asset remains. No private counts or monetary
totals belong in Git.

## Runtime integrity

All runtime objects, discriminants, booleans, identifiers, counts, signed
millionth improvements and memory values are validated fail-closed. Coverage
sums must remain safe integers. Historical-star conclusions use their own
eligible holdout count rather than inheriting direct-history coverage.

## Gate result

Every assessment keeps:

- Gate C not accepted;
- Gate E not accepted;
- recommendation activation disabled; and
- Production mutation disabled.

Synthetic regression coverage verifies chronology, same-event cutoff, partial
outcome exclusion, baseline partitioning, independent evidence coverage,
negative-lift handling, missing breeding/ME history, capacity limits and the
historical BGC no-ledger rule.
