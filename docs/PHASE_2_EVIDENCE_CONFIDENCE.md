# Phase 2 Evidence Confidence Contract

Date: 23 July 2026  
Status: unpublished repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Purpose

This Phase 2 slice defines an auditable confidence and coverage projection for
one authoritative core, mode and exact-distance performance profile.

Confidence describes the maturity and reliability of the available evidence. It
does not describe whether the core is fast, competitive or strategically
valuable. The contract deliberately does not consume elapsed-time values,
speed, star rates or benchmark percentiles when assigning a confidence level.

## Evidence components

The projection keeps these components separate:

- direct exact-distance race count and the owner-confirmed 10-race boundary;
- Gold/Blue source coverage, explicit assignment-opportunity denominators and
  anomaly counts;
- complete versus partial benchmark-event coverage;
- resolved versus unresolved lineage relationships;
- `Data current through`, `Last imported` and freshness; and
- chronological holdout, simple-baseline comparison and calibration results.

Missing evidence remains unavailable. It is never rendered as a zero rate or a
negative assessment of the core.

## Confidence levels

- `insufficient`: no direct exact-distance performance evidence;
- `low`: fewer than 10 direct races, stale/unknown data, or failed validation;
- `moderate`: at least 10 direct races with current/ageing evidence, while
  validation or complete benchmark evidence remains unfinished; and
- `high`: at least 10 direct races, current/ageing evidence, complete benchmark
  outcomes, a known import-completion time, and passed chronological holdout,
  baseline and calibration checks.

Ten races remains only the minimum minimally analytical sample. It cannot create
high confidence by itself. Any non-high assessment remains `experimental`.
`validated_evidence` describes passed evidence checks only; it is not an
actionable recommendation or proof of core quality.

## Coverage and warnings

The output exposes raw counts for every coverage component and emits stable
warnings for:

- unavailable or sub-minimum direct evidence;
- stale or unknown freshness;
- unknown import completion time;
- unavailable, partial or anomalous star evidence;
- unavailable or partial benchmark outcomes;
- unavailable or unresolved lineage; and
- incomplete or failed chronological validation.

Gold-ineligible races remain outside Gold assignment-opportunity denominators.
Star anomalies are visible but do not rewrite source facts. Supporting star or
lineage gaps do not silently overwrite the direct performance sample.

## Fail-closed validation

The contract rejects:

- negative or non-integer counts;
- invalid profile identity, mode, distance or freshness;
- a sample label inconsistent with the 10-race boundary;
- a star profile with a different core, mode or exact distance;
- star coverage totals that do not reconcile;
- star numerators or rate objects that disagree with their denominators;
- benchmark complete/partial totals that do not reconcile;
- benchmark evidence without a coverage timestamp; and
- an import time that precedes the profile data cutoff.

## Boundaries

This slice uses synthetic tests only. It does not:

- claim that chronological validation has passed on private race history;
- calculate performance quality or a recommendation score;
- enable Discovery, tournament, Maiden, breeding or lifecycle advice;
- connect private data, providers or hosted storage; or
- change Preview, Production or GitHub Actions state.

Gate C remains mandatory before analytical recommendations can be described as
dependable.

## Validation

Synthetic tests cover:

- the zero-, nine- and ten-race boundaries;
- the validation cap before high confidence;
- stale-data and failed-validation caps;
- independent star, benchmark and lineage coverage;
- explicit Gold/Blue numerators and denominators;
- deterministic stable warnings;
- fail-closed count, key, timestamp and sample-label validation; and
- proof that changing performance-quality values cannot change confidence.
