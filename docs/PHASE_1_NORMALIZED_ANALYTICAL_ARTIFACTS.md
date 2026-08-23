# Phase 1 Normalized Analytical Artifacts

## Purpose

This slice establishes the compact persistence boundary required to move
high-volume normalized and provenance evidence out of Neon and into private
analytical object storage without weakening import auditability.

The change is a foundation only. It does **not** switch the current Preview import
runtime away from the existing Neon staging tables, write normalized owner data to R2,
delete existing provenance, change Production, enable a paid tier or authorise the
first real upload.

## Capacity reason

`docs/CURRENT_REAL_SOURCE_STORAGE_PROJECTION.md` proves that the present PostgreSQL
retention shape cannot safely hold the audited first real import under the protected
512 MiB Preview branch limit. The mandatory per-row staging ledger and accepted
contribution ledger alone require at least 824,316,064 bytes for a usable current
source set before indexes, page overhead or any normalized/materialized relations are
counted.

The accepted Phase 0 architecture already assigns private Cloudflare R2 to raw uploads
and partitioned analytical data, while Neon stores application state, manifests,
durable aggregates and reconciliation. This slice restores that intended separation
by defining the compact manifest and object-store contract needed by later migration
work.

## Private analytical object contract

A normalized analytical artifact is one immutable private object associated with one
source import batch. The first supported representation is `parquet/v1`; object
identity is opaque and must not be a public URL.

The provider-neutral streaming store contract requires:

- owner, update-session, import-batch and source-family identity before provider work;
- bounded chunk writes rather than whole-object buffering;
- exact content SHA-256 and byte length;
- source, ready, quarantined and warning row counts;
- SHA-256 evidence for the normalized natural-key set;
- Race Merge minimum/maximum event timestamps when ready race rows exist;
- explicit abort reasons; and
- private read/delete operations for later verification and rollback/recovery slices.

This contract does not prescribe a public route or browser-readable object URL. The
Cloudflare R2 adapter remains a subsequent focused slice.

## Compact Neon manifest

Migration 0044 adds `dna.normalized_analytical_artifact`. It stores one compact row per
source import batch rather than one row per source record. The manifest records:

- owner and import-batch identity;
- source family;
- artifact format and private storage provider;
- opaque private object ID, SHA-256 and byte length;
- source/ready/quarantined/warning counts;
- natural-key-set SHA-256;
- Race event-time bounds where applicable; and
- lifecycle state and optional dataset-version binding.

The table is forced-RLS and owner-scoped. `PUBLIC` receives no table or function
rights. The private runtime receives only manifest reads and the bounded registration,
binding and rollback functions.

## Lifecycle

`prepared` means the normalized private artifact has been verified and registered for
an import batch but is not yet bound to an accepted dataset version.

`bound` means the manifest is linked to the exact owner/source/import dataset version.
Binding is idempotent only for that exact version.

`rolled_back` records that the bound dataset version was rolled back. A rolled-back
artifact cannot be rebound. Later object-retention/deletion policy will use this
lifecycle evidence; this slice deliberately does not delete provider objects.

The current cumulative Race Merge and Core Details semantics and replacement Current
Arena semantics remain unchanged. The manifest is an evidence carrier, not a new
source-authority rule.

## Next dependency-critical slices

1. Implement the private R2 normalized-artifact writer/reader against this contract,
   including streaming verification, bounded retries and zero-public-access evidence.
2. Change Preview normalization to write row-level analytical/provenance payloads to
   private artifacts while retaining compact Neon receipts/manifests.
3. Change activation and aggregate preparation to consume verified artifacts without
   reconstructing multi-million-row Neon staging ledgers.
4. Preserve exact replay, cross-segment overlap deduplication, conflict quarantine,
   rollback, replacement Arena and cumulative Core/Race semantics against the artifact
   path.
5. Remove obsolete high-volume Neon retention only after equivalent artifact evidence
   is proven and reversible.
6. Rerun the PostgreSQL 18 real-source storage projection and require explicit headroom
   before requesting the first real Preview upload.

No step in this document authorises Production, a paid provider change, public
exposure or a real owner-data upload.
