# Phase 1 Private Raw-Object Streaming

## Purpose

This slice defines the provider-neutral boundary for reading one privately stored
source object into prepared import staging. It does not configure Cloudflare R2,
create an upload route, persist real data or activate Preview or Production.

The boundary composes with the durable background-dispatch service. A worker must
first resolve and claim the persisted dispatch; queue payloads cannot supply an
object reference, owner identity, expected checksum or expected size.

## Contract

Each durable private object reference contains:

- a canonical, non-sensitive internal object ID;
- one supported source family;
- the expected positive byte length; and
- a lowercase SHA-256 checksum recorded by the accepted upload preview.

The private object store is owner-scoped. Opening an object requires the resolved
internal owner ID and canonical object ID. The storage adapter returns only an
advertised byte length and a valid asynchronous byte stream. Provider exceptions
are converted to stable failure codes without returning private provider detail.

Before any staging write, the reader:

1. runtime-validates and canonicalizes internal identities and manifest evidence;
2. enforces the approved maximum object size;
3. opens the object inside the owner scope; and
4. requires the storage metadata byte length to match the persisted preview.

The reader then processes chunks sequentially with awaited writes. It keeps only
the current chunk and the incremental SHA-256 state in memory. Empty chunks are
ignored, non-byte chunks fail closed and both individual chunk size and cumulative
object size are bounded.

## Transactional staging rule

The downstream sink is a prepared-staging boundary, not an active-dataset writer.
It has three explicit operations:

- write one bounded chunk;
- commit only after exact end-of-stream byte length and SHA-256 verification; or
- abort the prepared object on any integrity, capacity or staging failure.

No streamed value can become an active source fact merely because it was written
to temporary staging. Dataset activation remains the later owner-scoped
transaction already enforced by the background-processing service.

An advertised-size mismatch is rejected before staging begins. A truncated,
extended, corrupt, oversized or malformed stream aborts prepared staging and
cannot advance freshness, active versions, aggregates or recommendations. If the
abort cleanup itself fails, the original stable processing error remains
authoritative and the durable worker failure path can retry or quarantine the
dispatch. Storage and staging exception messages are never exposed.

## Privacy and retention

- Original objects remain in private raw storage for provenance and future
  analysis; this reader never deletes them.
- The routine result exposes only internal IDs, counts, size, checksum and stable
  failure codes.
- Filenames, raw rows and source values are not logged or committed to Git.
- Exact authenticated owner review remains a later private application workflow.
- Provider credentials, bucket configuration, public object URLs and signed
  browser reads are outside this contract.

## Validation

Synthetic tests cover:

- sequential bounded streaming with exact size and SHA-256 verification;
- commit only after the final verified chunk;
- advertised and streamed size mismatch;
- checksum mismatch;
- oversized chunks and total capacity;
- malformed non-byte chunks;
- canonical object identity propagation;
- malformed storage streams;
- redacted storage and staging failure plus abort; and
- unsafe identity or manifest evidence.

The full exact-head repository validation and provider-backed Preview evidence
remain mandatory before merge or Gate B acceptance. Production remains disabled.
