# Phase 2 Core Intelligence Read Workspace

## Purpose

Expose accepted owner-scoped Core performance aggregates through the private
application without scanning raw Race Merge history on a routine page request.
This is a read-only application boundary; it does not enable imports,
recommendations, provider provisioning, Preview or Production.

## Owner and persistence boundary

- Verify the authenticated Clerk user against the server-only owner allowlist
  before calling persistence.
- Return an explicit identity-disconnected state when authentication or the
  allowlist is unavailable.
- Return an explicit persistence-not-configured state until a private compact
  profile repository is supplied.
- Query only the authenticated owner's materialized performance profiles and
  latest accepted import timestamp.
- Keep provider creation lazy and server-only. A build or module import must not
  initialize a database SDK or make a network request.

## Projection integrity

- Keep Bike, Car and Horse separate at every exact distance in metres.
- Require one unique profile per durable core ID, mode and exact distance.
- Canonicalize runtime repository shapes and identifiers; reject malformed
  canonical timestamps, unsafe distances or counts, non-finite or
  mathematically inconsistent metrics, invalid nested star evidence and
  duplicate profile keys.
- Derive freshness at read time from the accepted current-through timestamp and
  server time rather than trusting a stored label.
- Preserve the less-than-10-race hypothesis-only boundary. Ten races is only
  minimally analytical.
- Keep star numerators and denominators together; missing star evidence remains
  unavailable rather than zero.
- Require imported profile evidence not to post-date its import, and display
  data-current-through and last-imported timestamps separately as semantic UTC
  times.
- Treat DNA's omitted public Esports profile coverage as unavailable, never as
  zero history. Accept completed Esports observations through a separate
  owner-scoped API repository, deduplicate race-plus-Core identity and partition
  profiles by exact race type and exact distance.
- Include normal and Esports counts in whole-Core coverage while keeping both
  evidence lanes separately queryable. Outcome-only API evidence remains useful
  but cannot fabricate missing elapsed-time metrics.

## Interface boundary

The Core Intelligence route is a dynamic Server Component and ships no
client-side persistence code. It exposes All evidence, Normal racing and
Esports tabs, labels connected evidence as a historical experimental snapshot,
not the current game field, and keeps the Esports tab fail-closed until its API
history repository is commissioned. Recommendations remain disabled until the
required chronological validation and owner gates pass.

## Deferred work

- provider-specific owner-scoped compact-profile SQL;
- representative private query and latency evidence;
- Gate C chronological holdout and calibration;
- recommendation activation; and
- Preview or Production configuration.
