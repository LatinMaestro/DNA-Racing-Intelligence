# Phase 1 Import File Preparation Client

## Scope

This slice adds bounded browser-side preparation of selected private CSV
exports. It creates the exact candidate metadata and `Blob` references consumed
by guarded upload intake and the direct-upload orchestrator.

## Contract

- Accept one to 24 private CSV selections and preserve grouped sequential Race
  Merge additions.
- Permit at most one Core Details, Current Vault or Current Arena replacement
  candidate per batch.
- Normalize private filenames and content types using the same accepted boundary
  as the server intake service.
- Reject empty, oversized, malformed or duplicate selections before hashing.
- Read each `Blob` in configurable 64 KiB to 16 MiB slices and feed an injected
  incremental SHA-256 state.
- Prepare files sequentially so memory is bounded to one chunk plus the browser
  and hasher implementation's fixed state.
- Report only synthetic client ID and byte counts through the progress callback.
- Reject cancellation before the next chunk and reject malformed digests.
- Return the original `Blob` by reference; do not copy or persist source bytes.

## Disabled boundaries

This slice does not provide a hashing package, file picker, form, object-store
adapter, database repository or queue. A concrete incremental SHA-256
implementation must be separately selected and reviewed before the workflow can
be enabled.

The authenticated server remains authoritative for capacity, metadata and
source-family validation. The background preview worker remains authoritative
for full-stream checksum verification before any preview can become
confirmable.

## Validation

Synthetic tests cover chunk boundaries, independent hash state, normalized
metadata, grouped-source rules, empty files, invalid chunk sizes, malformed
digests and cancellation. No real filenames, source bytes, provider tokens or
credentials are used.
