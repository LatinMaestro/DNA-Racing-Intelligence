# Phase 9 Private Chronological Evidence

Status: private hosted aggregate evidence; recommendation gates remain closed  
Evidence base head: `f0ddf35b3844c36d3558e0da75922b495227d76e`

## Scope and safeguards

The nine authoritative source exports were analyzed in a private hosted
workspace. Exact rows, filenames, identities, monetary values and private
derived per-core records remain outside Git. This document retains only
non-identifying aggregate evidence and limitations.

The analysis covered 2,536,710 supplied Race Merge rows. It removed 67 exact
boundary duplicates and evaluated 2,536,643 unique entries across 695,901
events from 2024-07-06 through 2026-07-11. All 45 observed mode and
exact-distance cells were retained.

## Outcome coverage

- 558,187 events have complete field and finishing-position evidence.
- 137,714 events are partial. Their elapsed-time evidence remains usable, but
  they are excluded from winner, Top-X, star-conversion and holdout outcomes.
- The six sequential files are not uniformly row-sorted by time. Holdout
  validation therefore uses an external chronological ordering stage.
- Predictions are generated before any entry from the same event updates
  history.
- Baselines remain separate by mode, exact distance in metres and gate count.

## Chronological dry run

The final 20% of the observed time span formed a holdout from 2026-02-14
through 2026-07-11. The dry run evaluated 197,008 paired, complete-event cases
with at least ten prior direct races in the same mode, exact-distance and
gate-count cell.

- The cell baseline Brier score was 0.156157 with a 0.005607 calibration gap.
- A simple direct-history candidate improved Brier score by 0.010128 and
  reduced the calibration gap to 0.001587.
- Adding a naive historical Gold/Blue feature worsened Brier score by 0.002186
  versus direct history and increased the calibration gap.
- The star feature had complete historical coverage for 152,472 paired cases
  and partial coverage for 44,536.

This validates chronological partitioning and demonstrates that direct history
is worth continued model work. It does not validate the repository's eventual
recommendation model or accept Gate C. The naive star feature must not be
promoted.

## Lineage and breeding

A parent-ID-only association dry run evaluated 299,121 cases for which both
parents had at least 20 prior races in the same mode. The simple parent-history
proxy worsened Brier score by 0.022320 against the corresponding context
baseline.

This does not establish that lineage lacks value. It rejects this naive proxy
and confirms that names must never supply relationships. Breeding lift and
Gate E remain blocked because the supplied sources contain lineage but not
breeding timestamps, prediction-at-breeding records or authoritative
post-breeding outcome joins.

## Gold and Blue change review

Complete, contiguous calendar months were compared within mode and exact
distance using minimum denominators of 1,000 assignment opportunities and 100
assigned-star outcomes. Material thresholds were 500 basis points for
assignment and 1,000 basis points for conversion.

Thirty-six adjacent-month boundaries are review candidates: 20 assignment-
only, 13 conversion-only and three affecting both. These signals do not prove
an algorithm change, identify a cause or authorize automatic era segmentation.

## Tournaments and Maiden

Historical tournament-like format evidence is present, but the Current Vault
ME value is a replacement snapshot rather than a point-in-time entitlement
history. Applying today's ME state to older events would leak future state.
Maiden and tournament backtesting therefore remain blocked until versioned
entitlement evidence is available or a deliberately narrower owner-reviewed
question is defined.

## Economics

The private replay confirmed 998 historical BGC rows across 467 events. They
remain performance evidence with zero effective fee, zero effective payout and
zero race-ledger transactions. All ordinary ETH/DEZ rows remain economically
parseable and no unknown race asset was found. Exact monetary aggregates remain
outside Git.

## Representative capacity

Four full aggregate scans completed off the request path in 25.1-27.5 seconds
with 124.9-125.4 MB peak memory. Each scan covered all supplied rows and
produced the same row, event, cell and era-candidate counts. A separate
externally ordered holdout completed in 28.3 seconds with 242.7 MB peak memory
and deleted its temporary private database.

This is representative background-processing evidence. It is not a deployed
routine-request latency measurement, does not accept Gate F and does not
authorize provider or Production changes.

## Gate result

- Gate C: not accepted.
- Gate E: not accepted.
- Recommendations: experimental and non-actionable.
- Production: disabled and fail-closed.

Synthetic regression coverage enforces chronological ordering, same-event
cutoff, partial-event exclusion, gate-count partitioning, negative-lift
handling, missing breeding/ME history, representative-background-only capacity
and the historical BGC no-ledger rule.
