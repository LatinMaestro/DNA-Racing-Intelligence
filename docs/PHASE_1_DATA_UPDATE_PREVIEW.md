# Phase 1 Data Update Preview Contract

Date: 24 July 2026  
Status: provider-independent domain and interface slice  
Production: disabled and fail-closed

## Scope

This slice implements the pre-confirmation boundary for the private owner Data
Updates workflow. It converts already inspected staged-file evidence into one
deterministic update plan before any active dataset changes.

File reading, raw-object persistence, database mutation, background execution
and rollback execution remain separate provider-backed services. No private
source file or provider credential is included.

## Source treatments

- Race Merge accepts several sequential additions together, orders them by
  event coverage and appends accepted history.
- Core Details accepts one update candidate and applies versioned durable-ID
  upserts.
- Current Vault accepts one complete replacement-snapshot candidate.
- Current Arena accepts one complete replacement-snapshot candidate.

Multiple competing Core Details, Vault or Arena candidates block confirmation
rather than selecting one silently.

## Preview evidence

For each source family, the preview reports:

- ordered staged upload identifiers;
- source and accepted row counts;
- exact replays and exact duplicates that will be ignored;
- conflicting and malformed rows;
- warnings;
- Race Merge event-time coverage; and
- the intended append, upsert or replacement treatment.

The authenticated owner workspace may separately show exact filenames, rows and
source values when useful for resolving an issue. Routine logs and repository
evidence remain redacted.

## Confirmation boundary

Confirmation remains disabled when any staged file has:

- an unsupported schema;
- conflicting rows;
- malformed rows; or
- another competing candidate for a single-file source family.

Warnings, exact replay and exact boundary duplicates remain visible but do not
block an otherwise valid plan. Confirmation is always explicit and starts
background processing; the preview itself never mutates active data.

## Validation

Synthetic tests cover grouped chronological Race Merge ordering, all four source
treatments, replay and duplicate accounting, blocking failures, competing
snapshot candidates, duplicate checksums, impossible classifications and
source-specific event-coverage rules.
