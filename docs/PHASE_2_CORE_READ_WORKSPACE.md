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
- Reject malformed timestamps, unsafe distances or counts, non-finite metrics,
  inconsistent sample labels and mismatched star-profile keys.
- Preserve the less-than-10-race hypothesis-only boundary. Ten races is only
  minimally analytical.
- Keep star numerators and denominators together; missing star evidence remains
  unavailable rather than zero.
- Display data-current-through and last-imported timestamps separately.

## Interface boundary

The Core Intelligence route is a dynamic Server Component and ships no
client-side persistence code. It labels connected evidence as a historical
experimental snapshot, not the current game field. Recommendations remain
disabled until the required chronological validation and owner gates pass.

## Deferred work

- provider-specific owner-scoped compact-profile SQL;
- representative private query and latency evidence;
- Gate C chronological holdout and calibration;
- recommendation activation; and
- Preview or Production configuration.
