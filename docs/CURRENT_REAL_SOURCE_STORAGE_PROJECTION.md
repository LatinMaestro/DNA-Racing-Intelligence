# Current Real-Source Neon Storage Projection

## Purpose

This document records the current reproducible Neon capacity decision for the owner’s audited **nine-file** recurring DNA Racing source set after the accepted-evidence compaction work merged in PR #238.

It is a **pre-upload safety gate**. It does not authorise a real upload, a paid provider change, a Production change, a Vercel Production deployment or any public release.

The audited source profile remains:

- seven sequential Race Merge files;
- one Core Details file;
- one Current Arena file;
- Race Merge rows: **2,691,579**;
- unique race events: **746,648**;
- Core Details rows: **18,513**;
- Current Arena rows: **1,474**; and
- total recurring source rows: **2,711,566**.

The protected Neon Preview branch has a logical-size limit of **512 MiB** (536,870,912 bytes).

## What PR #238 changed

The earlier projection measured two high-volume acceptance ledgers:

- `dna.dataset_staged_record`; and
- `dna.dataset_record_contribution`.

That earlier lower bound was about 786 MiB and correctly stopped the first real upload.

PR #238 materially improved the design. Accepted normalized evidence is now stored as private bounded evidence objects with durable Neon manifests/receipts, and successful activation can compact the transient staged-record and contribution ledgers after exact coverage and aggregate/materialisation safeguards pass.

That removes the old two-ledger duplication from the long-lived accepted state. The old 786 MiB calculation is therefore no longer the correct post-compaction capacity test.

However, compaction intentionally does **not** delete the durable normalized/materialized data needed by the current application contract. The capacity gate must therefore test those surviving relations instead.

## Durable rows that remain after compaction

The current accepted Race Merge path still retains in Neon:

- `dna.race_entry_source` — one durable source-provenance row for each accepted Race Merge row/import occurrence;
- `dna.race_event` — one normalized event row per unique race event;
- `dna.race_entry` — normalized race-entry facts;
- `dna.event_star_validation` — event-level Gold/Blue integrity evidence; and
- `dna.dataset_version_record` — durable replay/conflict/version evidence.

Core Details, Arena snapshots, economic rows, analytical aggregates and control-plane tables also remain, but the new proof does not need all of them to establish the stop condition.

## PostgreSQL 18 conservative measurement

`database/measurements/current_real_source_neon_lower_bound.sql` applies the complete current schema and uses `pg_column_size` against the actual PostgreSQL 18 composite row types.

The measured minimal materialized payloads are:

| Durable relation | Conservative measured row payload |
| --- | ---: |
| `race_entry_source` | 186 bytes |
| `race_event` | 129 bytes |
| `race_entry` | 137 bytes |
| `event_star_validation` | 158 bytes |
| `dataset_version_record` | 160 bytes |

The `race_entry_source` representative contains only values the accepted materialization path necessarily writes; optional source name, gate, format, class, asset, fee, payout, prize and tag values are left null/minimal. This intentionally understates real storage.

The projection is also deliberately conservative on row counts:

- `race_entry_source`: all **2,691,579** audited Race Merge source rows, because source provenance is retained per accepted import occurrence;
- `race_event`: **746,648** audited unique events;
- `event_star_validation`: **746,648** event validation rows;
- `race_entry`: only **one row per event** is counted, despite real races containing multiple entered cores; and
- `dataset_version_record`: only one Race Merge natural key per event plus the 18,513 Core Details and 1,474 Arena rows is counted, despite the actual Race Merge natural-key count being far higher.

This produces the following minimum composite payload:

| Durable relation | Lower-bound bytes | Approx. MiB |
| --- | ---: | ---: |
| `race_entry_source` | 500,633,694 | 477.44 |
| `race_event` | 96,317,592 | 91.86 |
| `race_entry` | 102,290,776 | 97.55 |
| `event_star_validation` | 117,970,384 | 112.51 |
| `dataset_version_record` | 122,661,600 | 116.98 |
| **Conservative durable total** | **939,874,046** | **896.33** |

The conservative durable total is approximately **1.751 × the entire 512 MiB Preview branch limit**, exceeding the limit by at least **403,003,134 bytes** before normal PostgreSQL heap/page/index overhead is counted.

This also excludes:

- indexes on every measured relation;
- page line pointers and table/index fill overhead;
- the fact that real `race_entry` cardinality is multiple rows per event rather than one;
- the fact that Race Merge `dataset_version_record` cardinality is far higher than one row per event;
- Core and lineage materialisation;
- Arena snapshot rows beyond the minimal version evidence;
- race-derived economic transactions and dated USD-rate records;
- Core Performance, star, payout-format and Discovery aggregates;
- import/control/evidence-manifest rows;
- future Race Merge rollover files; and
- the current schema’s existing logical footprint before any real data is imported.

The result is therefore a lower bound, not an estimate of likely total storage.

## Decision

**Current nine-file real Preview import: STOP / UNSAFE under the current durable Neon materialisation model.**

PR #238 successfully solved the transient staging/evidence duplication and made the synthetic hosted import path reliable, but it does **not** make the present multi-million-row durable Neon model fit within the 512 MiB Preview limit.

Do not request or perform the first real upload while this condition remains. Do not infer that purchasing more Neon capacity is authorised; the owner’s current direction remains to prefer the smallest practical low-cost architecture and to stop before unapproved paid thresholds.

## Next dependency-critical architecture slice

The next critical-path work is to reduce durable per-row Neon retention while preserving all analytical fidelity, replay protection, rollback and auditability.

The existing private R2 evidence boundary provides the natural storage layer for high-volume immutable source/normalized provenance. The next implementation should evaluate and then prove a design in which:

1. immutable row-level source/normalized provenance remains in private checksummed R2 partitions;
2. Neon retains compact owner-scoped manifests, version/coverage receipts and the bounded read models needed by the private website;
3. routine owner pages never scan the full multi-million-row raw history;
4. replay/conflict detection can use compact deterministic indexes/fingerprints or bounded partition evidence without a multi-million-row `dataset_version_record` ledger;
5. rollback can switch active version/manifest state and rebuild affected read models without retaining duplicate row-level provenance in Neon;
6. Search Core, Core Intelligence, Discovery, Breeding and Pro League still receive the exact mode/distance/star/payout evidence required by the approved specifications; and
7. a revised nine-file projection demonstrates explicit headroom below 512 MiB before any real upload is proposed.

A real owner upload remains separately gated even after a future capacity proof passes.

## Private object-storage observation

The current nine-file raw recurring payload audited on 11 August 2026 is approximately **392.5 MB**. Private R2 therefore remains necessary for the raw/evidence boundary. The present stop decision is driven by Neon durable row retention, not by a claim that the raw files should be stored in Git or proxied through ordinary web requests.

No current projection authorises a paid R2 or Neon change. Provider usage and storage must still be checked against the protected free/approved thresholds immediately before the first real upload.

## Reproducibility

The `Current real-source storage projection` GitHub Actions workflow uses PostgreSQL 18, applies the complete migration chain and executes `database/measurements/current_real_source_neon_lower_bound.sql`.

The SQL asserts both the measured row shapes and the 939,874,046-byte conservative post-compaction total. A future schema change that materially changes this capacity boundary must therefore update the proof explicitly rather than silently inheriting the old decision.
