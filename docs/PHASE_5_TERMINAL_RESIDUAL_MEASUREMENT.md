# P5 terminal residual measurement

## Live stop

Protected continuation `33688023472` preserved a valid unpublished checkpoint:

- 17,456 contiguous request receipts;
- 874,310,005 immutable private R2 bytes;
- one quarantine-bound unidentified finished-race observation; and
- no completion checksum or last-good publication.

The three newly authorized ordinals are `core_current_state`, not
`splice_arena`. They are the first three endpoint requests of the next Core
batch. The prior read-only amendment proved the Splice inventory in isolation
but did not prove that the Core family immediately before it had reached its
terminal batch.

## Correction

The terminal residual measurement is read-only and exact-main guarded. It:

1. loads and reconciles the complete compact Neon receipt prefix;
2. reads only four immutable R2 documents: the authoritative
   `vault.cores_full` observation and ordinals 17,454–17,456;
3. reconstructs the deterministic sorted Core-batch/endpoint plan;
4. verifies that all three late receipts match plan positions 73–75;
5. retrieves only the unobserved Core tail and complete Splice Arena inventory
   through the standing 30 aggregate requests/minute pool;
6. respects response-body status, rate headers, `Retry-After`, malformed-body
   retry limits and endpoint pagination/bulk limits;
7. emits only counts, byte totals, rate telemetry, hashes and conservative
   incremental provider bounds; and
8. re-proves that the checkpoint, owner data, last-good serving state and R2
   object inventory were not changed.

The connected run is limited to 32 residual logical requests, three API-key
lanes under one aggregate bucket, four immutable evidence reads and zero R2 or
Neon writes. It cannot complete the ledger or publish a serving generation.

## Gate

The current amendment remains historical authority for the work it bounded,
but it cannot authorize requests beyond ordinal 17,456. After the sanitized
residual artifact is reviewed, any increased receipt/API/R2/Class A/Class B/
Neon/cost maxima require a separate explicit owner amendment while retaining
the absolute USD $0.50 ceiling and all existing cleanup, omission,
non-publication and non-Production conditions.
