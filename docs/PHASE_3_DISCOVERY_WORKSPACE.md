# Phase 3 Discovery Read Workspace

## Purpose

Expose an owner-scoped review queue for exact core, mode and distance evidence
gaps without scanning raw Race Merge history on a routine request. This is an
experimental coverage-planning interface, not a race recommendation.

The owner-approved cross-mode classification and test-planning layer is defined
in `DISCOVERY_METHODOLOGY_V2.md` and implemented in
`domain/discovery-methodology.ts`. Future Discovery workspace work must consume
that shared contract for Bike, Horse and Car instead of rebuilding mode-specific
heuristics in the UI.

## Application boundary

- Verify the authenticated Clerk owner against the server-only allowlist before
  persistence.
- Return explicit identity-disconnected and persistence-not-configured states.
- Load only compact candidate evidence for the verified owner and build the
  deterministic probe plan at the application boundary.
- Reject invalid or noncanonical timestamps, future imports, future or post-import
  data cutoffs, duplicate cells, unsupported modes, unsafe counts, unresolved
  lineage samples and inconsistent runtime states.
- Derive freshness from the accepted data cutoff and server time. A persisted
  freshness label cannot promote stale or unavailable evidence.
- Keep providers lazy and server-only.

## Evidence boundary

- Keep Bike, Car and Horse separate at every exact distance in metres.
- Treat ten direct races as a minimum coverage boundary, not proof.
- Keep the owner-configurable twenty-observation normal-Free test target
  separate from that analytical boundary. Existing usable observations reduce
  the planned remainder.
- Classify normal-Free only from an authoritative standalone `Free` race-name
  token. Never infer it from entry price.
- Preserve normal-Free, competitive, tournament, esports and lineage evidence
  separately. See `DISCOVERY_NORMAL_FREE_STUDY.md`.
- Keep direct results primary and use resolved lineage only to form a
  hypothesis.
- Keep central pace, ceiling pace, repeatability/variance, sample size,
  opposition-adjusted stars and exact-format/gate evidence as separate visible
  axes. A single `+%` value or opaque score cannot represent all of them.
- A wide-range Core is not automatically weak: elite ceiling with ordinary
  central pace is a `variance_format` question until repeatability is resolved.
- A no-star outcome is caution only after repeated quality-known opportunities
  against strong/elite opposition; it never independently authorizes benching.
- Once a main distance is settled, exclude that Core from a pure Discovery
  roster unless a side-distance question remains.
- Before benching an apparently ordinary Core, test across two adjacent distance
  categories under the applicable mode configuration so the Core is not rejected
  merely because the first distance was wrong.
- Raise review priority for tournament relevance or Maiden preservation without
  authorising an entry.
- Defer stale, unknown-cutoff and unresolved-Maiden evidence.
- Preserve every Gate C, freshness, lineage and Maiden warning.

Every candidate remains experimental, non-actionable and unable to authorise
automatic entry, automatic promotion or automatic benching.

## Discovery classes and runner types

The workspace must preserve the shared methodology states rather than inventing
UI-only labels.

Discovery classes:

- `promote`;
- `confirm_side_distance`;
- `variance_format`;
- `rule_out`; and
- `settled`.

Runner archetypes:

- `repeatable_elite`;
- `volatile_elite`;
- `volatile_ceiling`;
- `format_specialist_candidate`;
- `high_upside_low_sample`;
- `ordinary`; and
- `unresolved`.

These are evidence states, not permanent Core labels. They must be recalculated
as the accepted sample grows.

## Interface

The route is a dynamic Server Component with no client-side persistence path.
The page displays historical import and data cutoffs separately, labels Gate C
as not passed and keeps race entry disabled.

The additive normal-Free study interface provides mode and audit filters, a
candidate matrix and per-distance table contracts with visually distinct
`TEST` and `SCREEN` states. Until authoritative race-name plus finished-time
history is available, it renders an explicit unavailable state rather than
turning legacy unknown evidence into zero observations.

The next Discovery UI iteration must also expose, where authority exists:

- mode selector for Bike / Horse / Car;
- Discovery class and runner archetype;
- median/central pace and benchmark position;
- best/ceiling pace separately;
- sample size;
- standard deviation and coefficient of variation when individual observations
  allow them;
- observed min/max range explicitly labelled as a range proxy when raw
  observations are unavailable;
- opposition-adjusted star evidence;
- exact format/gate evidence;
- settled main-distance state;
- side-distance questions;
- the two-band rule-out plan; and
- why a settled Core is excluded from the pure Discovery roster.

The UI must not hide these axes behind a single unexplained Discovery score.

## Cross-mode boundary

`DISCOVERY_METHODOLOGY_V2.md` applies to Bike, Horse and Car. Exact distances,
band definitions, star semantics, gate/field structures, ageing rules and other
mode-specific facts remain separate configuration authority. Bike distances
must never be copied into Horse or Car merely to populate the workspace.

## Deferred work

- provider-specific owner-scoped candidate SQL;
- representative chronological holdout and calibration evidence;
- authoritative Horse and Car exact-distance configurations;
- current tournament configuration;
- manual review actions; and
- Preview or Production configuration.
