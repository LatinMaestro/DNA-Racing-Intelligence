# Phase 2 Distance-Band Projection

Date: 23 July 2026  
Status: staged repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Scope

This Phase 2 slice groups merged exact-distance core-performance profiles into
the owner-confirmed Sprint, Middle and Marathon bands. It is a descriptive
navigation and evidence projection. It does not replace exact-distance
analysis, enable recommendations or establish Gate C analytical success.

## Confirmed bands

- Sprint: 900–1400 metres.
- Middle: 1400–1800 metres.
- Marathon: 1800–2200 metres.

The confirmed definitions overlap at 1400 m and 1800 m. A boundary profile is
therefore shown in both applicable bands and labelled through the
`sharedBoundaryProfileCount`. The projection does not silently choose one band
or duplicate an exact-distance profile within a single band.

## Evidence treatment

Bike, Car and Horse remain separate. Profiles are grouped by authoritative core
ID and mode, and every exact distance remains visible.

Elapsed times are not pooled across different distances because that would
produce a misleading mixed-distance statistic. Comparable metres-per-second
evidence is summarized as a transparent range while the exact-distance
profiles retain the underlying elapsed-time distributions.

Gold and Blue evidence is combined only by adding the existing raw counts and
assignment-opportunity denominators. Rates are recomputed from those summed
counts. Gold eligibility and anomaly exclusions remain visible; rates are never
averaged across exact-distance profiles.

## Coverage and freshness

Each summary exposes:

- the exact distances represented;
- total race count;
- minimally analytical and hypothesis-only exact-distance counts;
- latest and oldest profile cutoffs;
- all represented freshness states and the conservative worst state;
- exact-distance profiles with and without star evidence; and
- outside-band profiles as explicit warnings rather than silent exclusions.

All summaries remain `experimental` until Gate C chronological holdout,
baseline and calibration evidence passes. A distance-band summary must not be
presented as live game state or dependable advice.

## Validation

Synthetic tests cover:

- inclusive 900–2200 m definitions;
- shared 1400 m and 1800 m boundaries;
- core and mode separation;
- exact-distance preservation;
- count/denominator star aggregation;
- no mixed-distance elapsed-time statistic;
- conservative freshness and missing-star coverage;
- outside-band warnings;
- runtime mismatch and duplicate rejection; and
- deterministic input ordering.
