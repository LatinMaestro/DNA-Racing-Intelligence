# Phase 3 Discovery Path Review Contract

## Scope

This slice produces an experimental review signal for one core, mode and exact
distance. It does not stop Discovery, enter a race or spend an asset.

## Evidence order

Time percentile and direction are primary. Early Gold/Blue evidence over a
historically strong field may support continued review below the minimum sample,
but cannot override materially weak time. No-star evidence is explicitly
non-dispositive and cannot create a stop candidate.

A stop candidate requires at least the configured minimum direct sample and
weak time evidence. Thresholds are versioned inputs rather than hidden constants.
A time/star mismatch is held for review.

## Fail-closed boundary

Stale or unknown-cutoff evidence is insufficient. Missing direct-time evidence,
invalid runtime enums, inconsistent counts and unordered thresholds are rejected.
All signals remain non-actionable and automatic stop remains disabled until Gate
C chronological holdout, baseline and calibration evidence passes.

## Validation

Synthetic tests cover competitive time, early strong-field star support,
no-star protection, mature weak-time candidates, time/star mismatch, stale data,
time-count reconciliation and versioned threshold validation.
