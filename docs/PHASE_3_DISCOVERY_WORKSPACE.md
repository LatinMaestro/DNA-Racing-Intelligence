# Phase 3 Discovery Read Workspace

## Purpose

Expose an owner-scoped review queue for exact core, mode and distance evidence
gaps without scanning raw Race Merge history on a routine request. This is an
experimental coverage-planning interface, not a race recommendation.

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
- Raise review priority for tournament relevance or Maiden preservation without
  authorising an entry.
- Defer stale, unknown-cutoff and unresolved-Maiden evidence.
- Preserve every Gate C, freshness, lineage and Maiden warning.

Every candidate remains experimental, non-actionable and unable to authorise
automatic entry or stopping.

## Interface

The route is a dynamic Server Component with no client-side persistence path.
The page displays historical import and data cutoffs separately, labels Gate C
as not passed and keeps race entry disabled.

The additive normal-Free study interface provides mode and audit filters, a
candidate matrix and per-distance table contracts with visually distinct
`TEST` and `SCREEN` states. Until authoritative race-name plus finished-time
history is available, it renders an explicit unavailable state rather than
turning legacy unknown evidence into zero observations.

## Deferred work

- provider-specific owner-scoped candidate SQL;
- representative chronological holdout and calibration evidence;
- current tournament configuration;
- manual review actions; and
- Preview or Production configuration.
