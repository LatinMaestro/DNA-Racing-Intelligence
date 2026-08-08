# Phase 1 Import Upload Completion Service

## Purpose

This service closes the provider-neutral boundary between an issued direct
private-object upload target and background update-preview processing. It
acknowledges only owner-scoped objects whose private metadata agrees with the
durable reservation, then schedules a pre-confirmation preview exactly once.

## Contract

- Verify the authenticated Clerk owner against the server-side allowlist before
  any repository, object-store or queue operation.
- Remain `not_configured` until the owner-scoped repository, private object
  inspector and preview queue are all available.
- Load expected object IDs, byte lengths, content types and SHA-256 values only
  from the durable upload reservation.
- Bind the completion idempotency claim, durable replay and preview dispatch to
  the exact upload-request fingerprint returned by the guarded intake
  reservation. A changed fingerprint fails closed before object access.
- Reject expired direct-upload reservations using canonical server time; the
  owner must recover through a newly capacity-checked intake reservation.
- Inspect every object through its private owner scope and reject any public or
  cross-scope object. The provider response must repeat the exact owner, batch,
  upload-file and object identities so metadata cannot be substituted across
  reservations.
- Keep a batch pending when a direct upload has not arrived; do not schedule a
  partial preview.
- Require exact advertised byte length and normalized content type.
- Compare a provider SHA-256 when one is available. Its absence is permitted
  because the bounded preview processor must still stream and verify every byte
  against the reserved SHA-256 before accepting staged evidence.
- Reserve and enqueue one durable preview dispatch idempotently. Queue
  acknowledgement must repeat the exact dispatch ID and upload-request
  fingerprint; adapters must deduplicate retries on that durable dispatch ID.
- Record sanitized verification and queue failures without changing the active
  dataset.

## Activation and privacy boundary

Upload completion is not schema acceptance, preview confirmation or source
activation. It advances no active version, freshness timestamp, aggregate or
recommendation. The later preview worker must use the existing bounded raw
object stream, source adapters and deterministic preview contract before the
owner can confirm processing.

The service returns only opaque batch, file and dispatch identifiers. It does
not expose original filenames, object keys, checksums, provider errors or raw
values in routine output. A queued preview is not an accepted preview, owner
confirmation, processing result or source activation. Provider adapters,
route/action wiring, private Preview imports and Production remain disabled.

## Verification

Synthetic tests cover unavailable configuration, owner mismatch, private object
metadata agreement, missing uploads, public-object rejection, length and
checksum mismatch, absent provider checksum metadata, fingerprint drift,
expired reservations, cross-owner identity substitution, durable replay,
object-store failure and retry-safe preview-queue acknowledgement/failure.
