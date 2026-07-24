# Phase 2 Core Source Coverage

## Purpose

The Core Intelligence, Vault, Arena and breeding workflows must remain useful when the periodically imported sources cover different sets of durable core IDs. `domain/core-source-coverage.ts` projects those joins explicitly rather than filling missing evidence with zeroes, names or invented lineage.

The projection consumes only authoritative durable IDs from:

- accepted Core Details;
- confirmed Current Vault identities;
- the latest accepted Current Arena snapshot; and
- accepted Race Merge history.

It produces deterministic per-core states and aggregate counts suitable for compact persistence, application services and authenticated status displays.

## Context and profile states

Each core records every applicable source context: `current_vault`, `current_arena` and `race_history`.

| State | Meaning | Permitted use |
| --- | --- | --- |
| `ready` | Core Details and imported race history are both available | Attribute, lineage and performance views may be joined |
| `performance_only` | Race history exists but Core Details is absent | Performance evidence remains valid; attribute- and lineage-dependent claims are unavailable |
| `no_imported_racing_history` | Core Details exists but no accepted race is present | Identity and lineage may be shown; performance metrics remain unavailable rather than zero |
| `source_identity_only` | A Vault or Arena source ID exists without Core Details or race history | Preserve the source identity and require review before analytical or family use |

The status describes evidence coverage, not core quality. A missing profile must never be ranked as poor or treated as a zero-valued profile.

## Lineage states

- A parentless Genesis Core Details record is a complete `founder` state.
- A non-Genesis core is `available` for lineage checks only when it has exactly two distinct parent IDs and both parents exist in accepted Core Details.
- Missing Core Details produces `missing_core_details`.
- Partial, duplicated, unresolved or class-inconsistent parent evidence produces `incomplete_or_inconsistent`.
- Only `available` and `founder` lineage states are `checkable`; all other states are `review_required`.

`checkable` means the confirmed family-restriction service has enough source evidence to evaluate a proposed pairing. It is not itself an eligibility result. Pairing eligibility remains governed by the dedicated family validation contract.

Names never create or repair a relationship. Source IDs remain authoritative throughout the join.

## Confirmed private-source coverage

The approved aggregate source profile establishes the following acceptance cases:

- all 195 confirmed owned cores have Core Details and race history, so their analytical profiles are source-ready;
- 166 owned cores have recorded parents and 29 owned cores are founder/no-parent records;
- 2,162 raced durable IDs are absent from the supplied Core Details export and must remain performance-only;
- the current Arena snapshot has 792 IDs, of which 791 are present in Core Details and 770 have imported race history;
- 22 Arena IDs have no imported racing history and must display that state explicitly; and
- the full Core Details export contains 14,181 records with both parents and 3,946 founder/no-parent records.

These are coverage findings for the inspected snapshots, not permanent game-wide constants. Every later accepted import must recompute the states.

## Determinism and validation

The projection:

- rejects blank or duplicate IDs within each source boundary;
- validates parent identifiers before assigning lineage state;
- produces the same result regardless of input order;
- sorts output by durable core ID;
- reports explicit aggregate counts for each analytical state and family-review requirement; and
- uses synthetic fixtures only in repository tests.

Focused hosted verification covers owned-ready profiles, Genesis founders, performance-only race IDs, Arena no-history and identity-only states, incomplete lineage, deterministic ordering and invalid source evidence. Exact-head repository CI and database integration remain mandatory before merge.

## Application boundary

This domain projection is the source-status contract for later persistence and UI wiring. Application services must:

- recalculate affected coverage after an accepted source activation or rollback;
- show the relevant state wherever a metric or family check depends on unavailable evidence;
- keep historical performance for IDs missing from a newer Core Details export;
- avoid recommendations that require attributes or family evidence until that evidence is checkable; and
- display source freshness and the accepted-data cutoff alongside the profile.

The projection does not activate Preview providers, import private data into persistent hosting or change Production.