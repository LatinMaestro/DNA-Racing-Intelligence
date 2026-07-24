# Phase 2 Chronological Pre-Race Field Context

Date: 23 July 2026  
Status: unpublished repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Purpose

This Phase 2 slice creates auditable opponent-field context for a historical
event without using information that was unavailable when that event began.

It is a descriptive feature boundary, not a field-strength model. Strong, weak
and elite field labels remain unclassified until a benchmark frozen at the same
historical cutoff is supplied and chronologically validated.

## Strict historical cutoff

For a requested event, evidence is eligible only where:

`evidence event timestamp < requested event timestamp`

The strict comparison excludes:

- the requested event itself;
- another event with the same timestamp;
- the requested event's eventual times, finishes, prizes or payouts; and
- every later race.

Excluded same-time and future observations are counted so the no-leakage
boundary remains auditable.

## Exact evidence key

Opponent evidence must match:

- the entered historical event's mode;
- exact distance in metres; and
- an explicitly listed opponent core ID.

Bike, Car and Horse never merge. Adjacent distances do not enter this
exact-distance context. The entered owned core's own history is not included in
opponent field quality.

## Opponent projection

For each opponent, the projection exposes:

- prior exact-distance race count;
- prior best and median elapsed milliseconds;
- latest included prior race timestamp; and
- a prior Gold/Blue profile rebuilt only from star events before the cutoff.

The field summary exposes known/unknown opponent counts, fastest known prior best
and the median of known opponent medians. Missing opponents remain missing and
do not become average or poor opponents.

## Coverage and warnings

Stable warnings identify:

- a field with no listed opponents;
- no opponent history;
- partial opponent history;
- unavailable or partial prior star history;
- same-time or future evidence that was excluded; and
- the deliberately unclassified quality band.

Historical stars remain supporting pre-race evidence. They do not replace time,
and Gold assignment opportunities continue to exclude Gold-ineligible fields.

## Fail-closed validation

The contract rejects:

- blank event, entered-core or opponent IDs;
- duplicate opponent IDs or the entered core listed as its own opponent;
- unsupported mode or invalid distance;
- invalid timestamps, elapsed times or gate counts;
- duplicate event/core performance observations; and
- duplicate star event IDs, including duplicates outside the eligible cutoff.

## Boundaries

This slice does not:

- use current-event or future outcomes;
- assign strong/weak/elite field bands;
- calculate an opaque quality score;
- claim predictive success from synthetic data;
- enable Discovery, tournament, Maiden or lifecycle recommendations;
- connect private data or hosted providers; or
- alter Preview, Production or GitHub Actions state.

Gate C chronological holdout, benchmark and calibration evidence remains
mandatory before field-relative features become actionable.

## Validation

Synthetic tests cover:

- strict earlier-than cutoff behaviour;
- exclusion of target, simultaneous and future evidence;
- mode, exact-distance and opponent-only filtering;
- prior Gold/Blue profile rebuilding;
- complete, partial, missing and empty-field coverage;
- deterministic ordering;
- fail-closed invalid and duplicate evidence; and
- permanent unclassified field strength without a time-frozen benchmark.
