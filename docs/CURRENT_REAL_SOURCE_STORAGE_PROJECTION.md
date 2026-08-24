# Current Real-Source Neon Storage Projection

## Purpose

This document records the current reproducible Neon capacity decision for the owner’s audited **nine-file** recurring DNA Racing source set after PR #245 connected post-aggregate evidence sealing and Race Merge row/version-ledger compaction.

It is a **pre-upload safety gate**. It does not authorise a real upload, a paid provider change, a Production change, a Vercel deployment or any public release.

The audited source profile remains:

- seven sequential Race Merge files;
- one Core Details file;
- one Current Arena file;
- Race Merge rows / race-entry observations: **2,691,579**;
- unique race events: **746,648**;
- Core Details rows: **18,513**;
- Current Arena rows: **1,474**; and
- total recurring source rows: **2,711,566**.

The protected Neon Preview branch has a logical-size limit of **512 MiB** (536,870,912 bytes).

## What PRs #240–#245 changed

The earlier 939,874,046-byte (~896.33 MiB) lower bound was dominated by durable per-row Race Merge provenance and version-ledger duplication. The storage-critical sequence after that proof established a compact evidence boundary:

- dataset versions are sealed against immutable private checksummed evidence manifests;
- accepted Race Merge identity is retained as a compact 32-byte SHA-256 binding on the durable read model;
- payout-format evidence required by Pro League is retained in the analytical read model;
- rollback no longer depends on retained per-row source provenance;
- guarded Race Merge compaction removes `race_entry_source` and Race Merge `dataset_version_record` rows only after evidence/read-model prerequisites are complete; and
- aggregate publication now performs the seal/compaction boundary before publication is reported complete.

Those removed relations are therefore no longer counted in the durable post-publish lower bound.

## Corrected Race Merge read-model cardinality

The prior proof deliberately counted only one `race_entry` per unique event because it needed only a conclusive lower bound while the much larger provenance ledgers still existed. That understatement is no longer appropriate now that those ledgers are compacted.

For the current seven Race Merge files, the audited **2,691,579 Race Merge rows are race-entry observations**, so the revised durable lower bound counts **2,691,579 `race_entry` rows**. This is the realistic cardinality required for the current normalized historical read model.

The measured representative `race_entry` includes the mandatory 32-byte `source_fingerprint_sha256` identity introduced for replay/conflict safety. Optional payout-format text and other nullable values remain omitted, so the measurement is still conservative.

## PostgreSQL 18 measurement

`database/measurements/current_real_source_neon_lower_bound.sql` applies the complete current migration chain and uses `pg_column_size` against the actual PostgreSQL 18 composite row types.

Measured minimal row payloads are:

| Durable relation | Conservative measured row payload |
| --- | ---: |
| `race_event` | 129 bytes |
| `race_entry` with compact SHA identity | 170 bytes |
| `event_star_validation` | 158 bytes |
| Core/Arena `dataset_version_record` | 160 bytes |

The revised durable lower bound is:

| Durable relation | Lower-bound rows | Lower-bound bytes | Approx. MiB |
| --- | ---: | ---: | ---: |
| `race_event` | 746,648 | 96,317,592 | 91.86 |
| `race_entry` | 2,691,579 | 457,568,430 | 436.37 |
| `event_star_validation` | 746,648 | 117,970,384 | 112.51 |
| Core/Arena `dataset_version_record` | 19,987 | 3,197,920 | 3.05 |
| **Conservative durable total** | — | **675,054,326** | **643.78** |

The durable lower bound is **1.257 ×** the entire protected 512 MiB Preview branch limit. Explicit durable headroom is therefore **−138,183,414 bytes (−131.78 MiB)**.

Peak usage can never be lower than the durable state. The reproducible proof therefore also records a **minimum peak lower bound of 675,054,326 bytes** and **minimum peak headroom of −138,183,414 bytes**. Actual peak usage would be higher because transient upload/materialisation state is intentionally excluded.

## Conservatism and omitted storage

The 643.78 MiB figure is a lower bound, not a likely total. It excludes:

- PostgreSQL heap/page overhead and line pointers;
- indexes on the measured relations;
- optional populated Race Merge fields, including payout-format labels where present;
- bounded import/control/evidence-manifest/version/compaction receipts;
- Core Details and Arena materialized read models beyond the minimal version ledger;
- economic transaction and exchange-rate rows;
- Core Performance, star, payout-format, Discovery and other aggregate tables;
- existing schema/logical footprint before real data is imported;
- transient upload/normalization/materialisation rows; and
- future Race Merge rollover files.

Because the durable lower bound already exceeds the branch limit, none of those omissions can reverse the decision.

## Decision

**Current nine-file real Preview import remains STOP / UNSAFE.**

The evidence architecture work through PR #245 materially reduced durable duplication, from the prior ~896.33 MiB conservative lower bound to ~643.78 MiB. However, the normalized historical Race Merge read model itself is still too large: `race_entry` alone contributes ~436.37 MiB before indexes or page overhead, and `race_event` plus `event_star_validation` add another ~204.36 MiB.

There is **no safe headroom** under the protected 512 MiB Preview limit, so the first-real-upload gate must not be presented. No paid Neon/R2 capacity may be inferred or enabled from this result.

## Next dependency-critical architecture slice

The next storage target is no longer duplicate provenance. It is the multi-million-row normalized historical Race Merge read model.

The next implementation should preserve immutable private evidence in checksummed R2 while reducing long-lived Neon history to bounded query/read structures. The design must preserve the approved Search Core, Core Intelligence, Discovery, Breeding and Pro League evidence contracts. In particular it should:

1. keep exact historical race-entry/event evidence recoverable from immutable private R2 partitions;
2. retain bounded owner-scoped Neon manifests/version receipts and the aggregate/search structures needed for normal pages;
3. avoid storing every historical race entry as a full PostgreSQL row when the same evidence can be reconstructed or selectively fetched from checksummed partitions;
4. preserve compact replay/conflict identity and rollback/rebuild semantics;
5. keep event/star/payout evidence required by aggregate refreshes available without silently degrading analytical fidelity;
6. provide a bounded path for Search Core history/detail drill-down rather than forcing routine pages to scan the full archive; and
7. rerun this nine-file durable **and minimum-peak** proof after each material retention change until there is explicit positive safety headroom below 512 MiB.

A real owner upload remains separately gated even if a later proof passes.

## Reproducibility

The `Current real-source storage projection` GitHub Actions workflow uses PostgreSQL 18, applies the complete migration chain and executes `database/measurements/current_real_source_neon_lower_bound.sql`.

Exact-head run **32725752215** measured:

- `race_entry`: **170 bytes**;
- durable post-publish lower bound: **675,054,326 bytes**;
- minimum peak lower bound: **675,054,326 bytes**;
- protected Preview limit: **536,870,912 bytes**;
- durable/minimum-peak headroom: **−138,183,414 bytes**; and
- result: `UNSAFE_POST_PUBLISH_NEON_RETENTION`.

Future changes to the historical retention model must update this proof explicitly rather than inherit an obsolete capacity decision.
