# Phase 9 Gold and Blue Conversion Diagnostics

## Purpose

Measure how often historically assigned Gold stars converted to top-three
finishes and Blue stars converted to wins or top-three finishes without turning
post-race outcomes into pre-race model features.

## Contract

- Require star observation before the race result.
- Calculate conversion only when one assigned core and a valid finish are
  available.
- Exclude Gold conversion evidence at three gates or fewer while preserving and
  reporting an ineligible source assignment as an anomaly.
- Keep not-assigned, partial and invalid source states separate from conversion
  failure.
- Report explicit assigned counts, converted counts and rates.
- Keep mode, exact distance, gate count and star-algorithm era separate.
- Require a minimum assigned-event sample before a cell is descriptively ready.

## Boundaries

Conversion is an outcome diagnostic only. It creates no predictive feature,
cannot self-accept Gate C and cannot enable a racing, Maiden, breeding or
lifecycle recommendation.
