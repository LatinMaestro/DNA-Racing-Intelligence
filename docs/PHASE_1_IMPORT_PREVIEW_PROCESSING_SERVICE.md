# Phase 1 Import Preview Processing Service

## Purpose

This service defines the bounded background worker that converts one completed
private upload manifest into a deterministic pre-confirmation update preview. It
does not run the confirmed import, activate a source version or refresh
recommendations.

## Contract

- Claim one durable preview dispatch through a bounded worker lease.
- Load owner, batch, private object references, exact byte lengths and SHA-256
  values only from the persisted upload manifest.
- Require unique object and upload-file identities and supported source
  families.
- Bind the prepared preview to the exact upload-manifest SHA-256.
- Require the preview processor to stream and verify every private object,
  detect schema and encoding, apply source-specific adapters and build the
  deterministic update plan.
- Validate file count, represented source-family count, blocking-issue count
  and confirmation state before publication.
- A preview is confirmable if and only if it has no blocking issue.
- Publish a prepared preview idempotently; lease contention and completed replay
  cannot duplicate processing.
- Record a sanitized failure without publishing partial preview evidence.

## Data and activation boundary

The repository must publish the prepared preview only if the exact upload
manifest remains current for the dispatch. Private object bytes, filenames,
checksums and row evidence remain outside routine output.

A published preview is review evidence only. It advances no active source
version, data-current-through timestamp, aggregate or recommendation. Explicit
owner confirmation and the separately guarded activation service remain
mandatory.

Provider repositories, queues and raw-object adapters, authenticated route/action
wiring, Preview imports and Production remain disabled.

## Verification

Synthetic tests cover unavailable configuration, successful leasing and
publication, missing dispatches, competing leases, completed replay, processor
failure, manifest mismatch, inconsistent counts, blocked previews and malformed
durable source evidence.
