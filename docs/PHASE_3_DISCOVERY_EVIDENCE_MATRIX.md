# Phase 3 Discovery Evidence Matrix

## Scope

This slice creates an auditable evidence matrix for each authoritative core ×
mode × exact-distance cell. It organizes evidence but does not calculate a
composite quality score, issue an actionable recommendation or stop Discovery.

## Evidence contract

Each cell preserves:

- direct race count, best/median elapsed time and successful-time percentile;
- the 10-race minimum and additional races required to reach it;
- lineage evidence in the confirmed parent-to-population priority order;
- Gold eligibility and Gold/Blue assignment-opportunity denominators;
- strong-field star and weak-field eligible no-star counts;
- ME and upcoming-tournament strategic context; and
- `Data current through`, `Last imported` and freshness separately.

Bike, Car and Horse remain separate. Exact distances never merge.

## Integrity controls

- Direct metrics are unavailable, not zero, when no direct races exist.
- Fewer than 10 exact-distance races remains hypothesis-only.
- Lineage evidence cannot extend beyond the cell's historical cutoff.
- Gold counts cannot exceed Gold-eligible or assignment-opportunity evidence.
- Missing, partial, invalid and unresolved evidence remains visible.
- No-star evidence can never create an automatic stop.
- Every cell remains experimental and non-actionable until Gate C holdout,
  baseline and calibration evidence passes.

## Deferred work

Targeted probe scoring, stop/continue thresholds, outlier exploration,
tournament/ME prioritisation and UI composition remain later focused slices.
Full exact-head CI remains mandatory before merge.
