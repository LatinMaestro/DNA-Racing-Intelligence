# Phase 1 Import Upload Intake Service

## Purpose

This service defines the private, owner-scoped boundary that starts a direct raw
export upload. It prepares the future authenticated Data Updates action without
enabling a provider, accepting private bytes through a Vercel request, activating
an import or changing the current dataset.

## Contract

- Verify the authenticated Clerk owner against the server-side owner allowlist
  before any capacity, persistence or object-store operation.
- Remain `not_configured` unless the owner-scoped repository, approved-capacity
  gate and private object-store target provider are all available.
- Accept CSV metadata only, including a bounded size, exact SHA-256 checksum,
  normalized content type and private original filename.
- Permit multiple sequential Race Merge candidates in one upload batch.
- Permit at most one Core Details, Current Vault or Current Arena replacement
  candidate per source family in one batch.
- Apply the approved capacity gate before reserving durable upload state.
- Reserve the batch idempotently before issuing opaque, short-lived direct
  object-store targets.
- Bind every reservation and state transition to a canonical SHA-256
  fingerprint of the idempotency key and ordered file metadata. A reused key
  with changed files, ordering, sizes, source families or checksums fails
  closed before any object target is issued.
- Validate provider-returned reservation identities, replay disposition,
  fingerprint, upload method and bounded control-free opaque target token at
  the application boundary.
- Never proxy or buffer the export bytes through the application service.
- Mark an incomplete target reservation failed without changing active source
  versions, freshness, aggregates or recommendations.

## Privacy and activation boundary

The original filename is retained only as authenticated private provenance. The
service emits no logs and returns opaque upload tokens only to its authenticated
caller. Raw rows, filenames and source values remain outside Git, CI and routine
logs.

Uploading an object is not preview confirmation or source activation. Exact
stored length and checksum must still be verified by the private streaming
processor before preview, confirmation, background processing and transactional
activation. Providers, database writes, action/route wiring, Preview imports and
Production remain disabled.

## Verification

Synthetic tests cover unavailable configuration, owner mismatch, grouped Race
Merge candidates, competing replacement snapshots, malformed metadata,
capacity-before-reservation ordering, durable replay, provider failure recovery
and inconsistent reservation identities.
