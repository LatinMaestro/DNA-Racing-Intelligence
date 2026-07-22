# Phase 1 Star Integrity Contract

Date: 23 July 2026  
Status: provider-independent validation and refresh contract complete  
Production: disabled and fail-closed

## Scope

This slice defines the deterministic event validation and core-profile refresh
that must run after authoritative Race Merge facts have been accepted. It does
not reconcile manual post-lock observations, derive field strength or make a
predictive-quality claim. Tests use synthetic fixtures only.

## Event validation

Every event is validated as one unit before its star facts can create profile
denominators.

- Gold eligibility is derived only from `gate_count > 3`.
- Source Gold in a one-, two- or three-gate event is preserved and reported as
  `GOLD_INELIGIBLE_ASSIGNMENT`; it cannot create positive or negative Gold
  evidence.
- Zero, one and multiple Gold or Blue assignments remain distinct.
- Multiple assignments are invalid. All assigned source core IDs are retained
  in deterministic order, while the unique assigned-core field remains null so
  no false winner is selected.
- A single core may validly receive both Gold and Blue.
- Complete, partial, missing and invalid star data have separate counts.
- Duplicate core rows and empty events are invalid rather than silently
  deduplicated into valid evidence.
- An assignment opportunity exists only when the event has exactly one
  assignment for that signal, every row has complete data for that signal and
  core rows are unique. Missing Gold does not discard otherwise complete Blue
  evidence, or vice versa. Gold additionally requires more than three gates.

An invalid or incomplete event remains visible in validation output. It is not
rewritten, and its affected signal cannot enter an assignment denominator.

## Core-profile refresh

Profiles are grouped by authoritative source core ID, mode and exact distance.
Input events are sorted, assigned-core IDs are sorted, and output profiles are
sorted, so replay and input ordering produce the same result. Repeated event IDs
fail closed to prevent duplicate evidence.

Each profile exposes counts rather than an unexplained percentage:

- races and complete/partial/missing/invalid coverage;
- Gold-eligible races;
- Gold and Blue assignment opportunities;
- received and negative-opportunity counts;
- eligible complete events with no assignment, which are not negative
  opportunities;
- ineligible source Gold anomalies;
- excluded anomalous events;
- same-core Gold-and-Blue occurrences; and
- explicit numerator/denominator pairs for received rates.

`dataCurrentThrough` is the latest included event timestamp. It describes the
accepted historical cutoff, not live game state.

## Deferred persistence boundary

The PostgreSQL executor will materialize this contract only after normalized
Race Merge facts are transactionally written to `race_event` and `race_entry`.
That migration must preserve multi-assignment core ID sets without choosing a
single source core, use an atomic replace/upsert for affected profiles, retain
owner RLS and pass reversible migration checks. Manual observations remain in
their separate reconciliation model and are excluded until authoritative
matching succeeds.

## Synthetic evidence

Tests cover:

- Gold eligibility at the three/four-gate boundary;
- ineligible source assignments;
- multiple Gold assignments without false selection;
- same-core Gold and Blue;
- incomplete-data denominator exclusion;
- eligible complete events with no assignment;
- exact mode/distance separation;
- positive and negative opportunity counts;
- explicit numerator/denominator output;
- deterministic replay and input ordering; and
- duplicate-event rejection.
