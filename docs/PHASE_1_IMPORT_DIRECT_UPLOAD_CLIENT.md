# Phase 1 Import Direct-Upload Client

## Scope

This slice adds a provider-neutral browser orchestration boundary between a
validated upload reservation and the existing upload-completion Server Action.
It does not add a file picker, object-store SDK, persistence adapter or enabled
route.

## Contract

- Match every selected `Blob`, prepared upload candidate and reserved target by
  the synthetic client file ID.
- Reject missing, duplicate, expired or inconsistent target sets before network
  work begins.
- Verify that the selected `Blob.size` still equals the prepared byte length.
- Pass the `Blob` directly to the injected private-object transport. The
  orchestrator never calls `arrayBuffer()`, `text()` or another whole-file read.
- Upload one object at a time to preserve a bounded transfer boundary.
- Do not send original filenames to the private-object transport.
- Request upload completion only after every object succeeds.
- Return a sanitized file ID on transfer failure and retain no provider error
  detail.
- Forward the existing idempotent completion result without activating source
  versions, freshness, aggregates or recommendations.

## Disabled boundaries

The private-object transport and completion capability remain injected and
unconfigured. This slice cannot create an upload reservation, generate an
object-store target, inspect provider metadata, publish a preview, confirm an
import, activate a source version or change Production.

Candidate checksum preparation remains a separate bounded client concern. The
authoritative preview worker must still stream each stored object and verify its
full SHA-256 before prepared evidence can be published.

## Validation

Synthetic tests cover exact mapping, sequential transfer, expiry, missing and
duplicate identities, changed byte length, sanitized transfer failure and
idempotent completion forwarding. No real filenames, source bytes, object
tokens or provider credentials are used.
