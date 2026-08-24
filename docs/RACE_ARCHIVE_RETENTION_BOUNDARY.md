# Race Archive Retention Boundary

## Purpose

The seven-file Race Merge history is too large to retain indefinitely as a fully normalized PostgreSQL row set inside the protected 512 MiB Neon Preview branch. The accepted architecture therefore treats the private checksummed R2 evidence objects as the immutable historical source of truth and Neon as the bounded owner-scoped control, aggregate and query layer.

This boundary does **not** permit the first real upload by itself. It defines the invariants that must be satisfied before detailed Race rows can be compacted and the nine-file capacity proof can be rerun.

## Immutable evidence

Every accepted Race Merge file must retain complete checksummed private R2 evidence registered in `dna.dataset_evidence_object` and sealed by `dna.dataset_version_evidence_receipt`. Evidence coverage must equal the accepted source-row count before any detailed relational evidence can be removed.

The R2 evidence remains the rebuild, replay, conflict-resolution and audit source. Routine application requests must not scan the full archive.

## Bounded Neon responsibilities

Neon should retain only data required for safe control-plane operation and efficient authenticated product reads, including:

- import batches, dataset versions, immutable evidence manifests and compaction receipts;
- stable replay/conflict fingerprints that are materially smaller than the original rows;
- current owner Core, Vault and Arena state;
- precomputed Core Performance, Core Star, payout-format and Discovery aggregates;
- exact owner economic transactions and reconciliation records;
- bounded archive/query locators required for historical drill-down; and
- enough state to prove which immutable evidence and aggregate generation produced the current read model.

The full historical `race_entry`, `race_event` and event-level star-validation tables are rebuildable working/read models, not the long-term evidence boundary.

## Economic audit independence

Race-derived economics must survive detailed Race read-model compaction. Durable economic records therefore carry the authoritative `source_event_id` and `source_core_id` pair in addition to the deterministic historical `race_entry_id`. New race-derived economic rows bind that archive identity while the accepted Race entry exists, and the binding is immutable afterwards.

A compacted Race entry must not delete or invalidate:

- the economic transaction;
- its race economic contribution;
- original asset/currency and exact amount;
- event/core source identity;
- payout mechanism or race-tag provenance already copied into the durable economic layer;
- USD valuation/reconciliation evidence; or
- reporting through the owner-scoped economic views.

This removes a hard foreign-key dependency from the durable economic ledger to the rebuildable multi-million-row Race read model without weakening auditability.

## Remaining compaction gates

Detailed Race rows must not yet be compacted solely because economic records are independent. A later compaction change must additionally prove that:

1. the active Race dataset version has complete sealed private evidence;
2. all current aggregate families were published from the exact active source-version set;
3. future aggregate refresh can rebuild or increment from R2 evidence without requiring already-compacted PostgreSQL detail rows;
4. manual post-lock star observation reconciliation remains recoverable from stable source event identity;
5. Search Core/history drill-down has a bounded owner-scoped archive locator/read path;
6. rollback can restore the prior analytical state from immutable evidence rather than toggling deleted rows; and
7. the revised durable and minimum-peak nine-file projection has explicit positive headroom below 512 MiB, including indexes and operating overhead rather than row payload alone.

Until those conditions pass on exact-head CI and protected synthetic Preview evidence, the first-real-upload decision remains **STOP / UNSAFE**.

## Provider and deployment boundary

This architecture change does not require a Vercel deployment, Production change, real owner upload, paid Neon/R2 capacity or public route. Provider commissioning remains limited to protected private Preview synthetic evidence after the corresponding repository controls are merged and capacity is proven safe.