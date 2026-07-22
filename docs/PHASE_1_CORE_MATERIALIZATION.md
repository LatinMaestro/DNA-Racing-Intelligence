# Phase 1 Core Details Materialization

## Scope

This slice transactionally materializes normalized Core Details facts and parent edges after schema detection, row adaptation and generic dataset staging have succeeded. It treats the legacy Bike-labelled export as cross-mode Core Details and uses its `bikeid` alias only as normalized `core_id`.

## Acceptance boundary

`normalized_core_staged_fact` stores one private typed fact for every ready staged row. `accept_staged_core_dataset` requires complete typed coverage and calls the owner/source-locked cumulative dataset ledger inside the same database transaction.

Before activation, it quarantines:

- self-parent rows;
- duplicate parent IDs;
- inconsistent facts for one source core ID;
- changes to an already selected core identity; and
- changes to an already selected parent role.

Parent IDs are authoritative. Parent names are retained only as private provenance and never create or resolve an identity. A source parent ID without its own Core Details row creates a nullable placeholder identity so the unresolved lineage remains visible rather than being guessed from a name.

## Materialized facts

Accepted facts use deterministic owner-scoped IDs for:

- normalized cores;
- core-import provenance;
- parent edges; and
- parent-edge import provenance.

Father and mother source fields map consistently to the schema's `parent_1` and `parent_2` roles. The source values remain available in private staging and parent-edge provenance. Exact replay reselects existing provenance without duplicating cores, edges or versions.

`active_core_details` exposes only cores with selected, non-rolled-back materialization provenance. Family evaluation returns `review_required / inactive_core_details` when either requested core is historical or rolled back.

## Rollback and lineage refresh

Core Details rollback uses the same owner/source lock as activation. It:

1. rolls back only the active dataset version with a required reason;
2. deselects core and parent-edge provenance contributed by that version;
3. retains historical cores, edges and provenance for audit;
4. restores prior selected source-batch pointers;
5. excludes inactive edges from the derived lineage graph; and
6. refreshes lineage only after rollback state is complete.

Lineage refresh reads selected Core Details and active parent edges. Historical inactive cores cannot silently become breeding candidates or re-enter family relationships.

## Privacy and verification

All new tables are owner-scoped with forced row-level security. Tables, views and functions are revoked from `PUBLIC`. Synthetic PostgreSQL 16 verification covers typed-fact completeness, cumulative activation, structural quarantine, exact replay, parent/full-sibling evaluation, rollback restoration, inactive-core protection, privilege revocation and complete reverse migration.

No private export, real core name, provider account, secret, hosted database or Production setting is changed by this repository-only migration.
