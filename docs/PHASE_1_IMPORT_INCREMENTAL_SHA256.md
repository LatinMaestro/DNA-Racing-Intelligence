# Import Incremental SHA-256

## Purpose

Provide the independent browser-side incremental SHA-256 state required by the
bounded private file-preparation client.

## Boundary

- Accept only `Uint8Array` chunks.
- Retain one 64-byte block, one 64-word message schedule and eight state words.
- Process each supplied chunk synchronously without retaining a reference to it.
- Support the current five-gigabyte per-file intake boundary without converting
  the export into one whole-file browser buffer.
- Return a lowercase 64-character digest.
- Finalize idempotently and reject any later update.
- Carry no authenticated owner ID, provider client, object target, database
  connection, filename or source metadata.

## Verification

Synthetic tests use the published empty, `abc`, long-message and million-`a`
SHA-256 vectors. They also verify identical results across one-byte and
63/64/65-byte chunking and exercise the real bounded file-preparation client.

The background preview worker remains authoritative: it must independently
stream each stored private object and compare the complete byte length and
SHA-256 before publishing a confirmable preview.

## Disabled boundaries

The hasher is not wired to a file picker or upload form. Private storage,
persistence, queues, Preview imports and Production remain disabled.
