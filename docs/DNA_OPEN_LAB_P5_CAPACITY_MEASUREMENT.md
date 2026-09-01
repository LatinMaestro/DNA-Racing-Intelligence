# DNA Open Lab P5 API-only capacity measurement

## Authority

This contract measures only the API-first current-state path. It does not use or
require the retired CSV ingestion path. A report is bound to one exact code head,
one complete acquisition-plan checksum, one provider scope, one measurement
evidence reference and one observation time.

It cannot authorise persistent owner-data sync, Production, deployment, paid
capacity or any DNA transaction.

## PostgreSQL 18 evidence

Measure the protected private Preview path on PostgreSQL 18 and record:

- the existing database baseline;
- settled database size after a complete synthetic full cycle;
- the maximum sampled database size while staging and atomic publication overlap;
- owner-scoped heap, index and TOAST bytes after settlement; and
- a baseline sample, at least one component-triggered transient sample and a
  settled sample so a single settled reading cannot be presented as
  transient-peak evidence.

The concrete Neon adapter opens a fresh serializable read-only transaction for
each observation, binds the application owner scope and verifies that the
runtime role is neither privileged nor able to create database/schema objects.
Owner relation totals are limited to an explicit, validated relation allowlist;
missing relations fail the measurement rather than silently reducing it.
The allowlist is the fixed complete DNA Open Lab schema inventory through
migration `0076`; a measurement caller cannot replace it with a smaller set.

The synthetic workload itself is also fixed. It uses the production all-family
publication repository with generated, non-owner fixture values, samples while
the serializable publication transaction is still open, and replaces the final
commit with `ROLLBACK`. Cleanup then proves that the synthetic generation is not
accepted or serving. Callers can no longer substitute a callback that merely
claims a synthetic cycle completed.

The approved boundary remains `536870912` bytes. Peak—not settled size—is used
for headroom. Zero headroom is blocking. Because the workload is forcibly
rolled back, a clean settled reading may equal the baseline. Complete-cycle
proof instead requires the component-triggered transient sample, intercepted
commit, rollback and zero-residue checks; durable database growth is neither
expected nor required.

## Private R2 evidence and cost

Record retained object count, payload bytes, metadata bytes, projected monthly
Class A and Class B operations, and a dated provider-price authority. Prices are
inputs expressed as integer micro-USD; the repository deliberately does not
hard-code time-sensitive provider pricing. Price authority may be at most 31
days old. Cost arithmetic rounds each billed component upward and remains
reproducible. Empty footprint or operation observations fail closed.

## Safety and gate interpretation

- Local synthetic evidence exercises the contract but cannot satisfy connected
  P5 evidence.
- A protected private Preview report may update only the three capacity rows in
  the P5 readiness matrix after complete review.
- Positive capacity evidence still cannot authorise the first persistent sync;
  connected recovery evidence and explicit owner approval remain separate.
- Every bounded provider test must use synthetic data, write no persistent real
  owner data, include no raw payload or secret material, and leave zero residue.
- The runner always invokes cleanup, including after a measurement failure, and
  rejects unsafe cleanup evidence.
- R2 enumeration requires a private bucket, bounds pages and object count,
  rejects repeated cursors and deduplicates by redacted SHA-256 object identity.
  Raw object keys and bodies do not enter the footprint report.
- The concrete R2 adapter confines every list to the hashed DNA Open Lab owner
  prefix. Payload bytes come from the binding's object size. Metadata bytes are
  the exact UTF-8 bytes of returned application HTTP/custom metadata keys and
  values; they do not claim to represent undocumented provider-internal
  overhead. Pricing authority remains responsible for the applicable provider
  billing semantics.
- The workload creates one bounded JSON marker below that same hashed owner
  prefix, verifies its checksum and metadata, includes it in the measured
  footprint, and deletes it during mandatory cleanup. A pre-existing marker,
  failed rollback, retained marker or accepted synthetic generation fails the
  measurement.

## Current state

The measurement contract, rollback-only full-publication workload and
least-privilege PostgreSQL/R2 adapters are implemented. A single guarded
composition fixes the provider scope to private Preview, constructs the
measurement adapters and constructs the synthetic cycle/cleanup adapter.
Connected run `33227016073` failed safely and motivated the corrected rollback
settlement rule. Exact-main run `33227770750` then passed every prerequisite,
measurement, cleanup and final-head step and retained the sanitized artifact
with digest
`sha256:3c9b47aff03ee63554eabf249304fd2f9009c7075c3ba407149ee3dac36823b9`.
It satisfied the PostgreSQL physical/peak, private R2 footprint/cost and positive
Neon headroom rows without authorising persistent sync or Production.

A separate dispatch-only, read-only provider preflight now reduces the live
configuration to identity-free prerequisite counts and blocker IDs. It requires
PostgreSQL 18, the exact owner binding, the non-privileged runtime contract, all
15 API-only relations, all 14 runtime function signatures, revocation of the
legacy unindexed publisher, a private bucket, owner-prefix list access and zero
P5 synthetic marker residue. It cannot write either provider, open P5, permit a
persistent Preview sync or authorize Production.

Migrations `0069`–`0076` were applied and smoke-tested on the private Preview
database without owner-data persistence. Exact-main prerequisite run
`33224616911` on 2026-08-29 then confirmed PostgreSQL 18, all 15 API-only
relations, the then-listed 13 runtime function signatures, the owner/RLS and
restricted runtime contract, private R2 access and zero synthetic residue. The
preflight contract now requires a fourteenth signature: migration `0077`'s
owner-scoped recovery fingerprint reader. It still permits only bounded
synthetic measurement, never persistent Preview sync or Production.

The connected invocation is separately opt-in, exact-head bound and limited to
the guarded composition. The dispatch-only exact-main workflow rejects a stale
dispatch head, re-proves prerequisites before measurement, proves cleanup
afterward and rejects evidence if `main` advances during the run. It emits one
canonical record no larger than 16 KiB and retains that sanitized artifact for
seven days only when measurement, cleanup and final exact-main proof pass.
The record contains only reviewed counts, timestamps, hashes, costs and safety
conclusions: authority references are domain-separated hashes, while provider
configuration, credentials, owner/database/bucket/object identities, cursors,
payloads and provider error details are never emitted. Its accepted
capacity-plan hash used the deliberately conservative assumption that the 30
aggregate requests/minute ceiling ran continuously for 30 days: 1,296,000
projected Class A writes and 2,592,000 projected Class B verifications. That
remains valid historical upper-bound evidence, but it is not the commissioned
operating cadence. The owner-approved recurring policy is one complete refresh
per day, capped at 1,000 Class A and 2,000 Class B operations per refresh
(31,000/62,000 over 31 days), with hard 80%-of-free-tier budgets and pre-write
shutdown before paid usage. Pricing uses the
official Cloudflare R2 authority effective 2026-08-07: $0.015/GB-month,
$4.50/million Class A and $0.36/million Class B, without subtracting the free
tier. The successful evidence measured a 17,768,448-byte PostgreSQL peak,
519,102,464 bytes of positive headroom, a 300-byte bounded synthetic R2
footprint and a 6,765,121 micro-USD 30-day projection. The artifact reported
`connectedCapacityEvidenceComplete` and `readyToUpdateP5CapacityRows` as true,
while persistent Preview sync and Production remained false. This capacity
evidence alone does not open P5; connected recovery acceptance remains pending.
