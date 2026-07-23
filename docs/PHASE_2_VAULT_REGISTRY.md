# Phase 2 Current Vault Registry Contract

Date: 23 July 2026  
Status: repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Scope

This Phase 2 slice defines the current-vault ownership boundary that future
profiles, discovery, Maiden, tournament, breeding and lifecycle features must
use. It combines the latest accepted Current Vault snapshot with explicit
owner edits without treating a suggested name or composite match as confirmed
ownership.

It does not upload a private snapshot, mutate a hosted database, expose names,
or enable recommendations.

## Ownership authority

A snapshot entry enters the active Vault only when its durable Core Details ID
has been explicitly confirmed. A proposed candidate remains an identity-review
item and cannot create ownership, race P/L, a profile or a recommendation.

Confirmed snapshot IDs must be unique. Duplicate confirmed ownership fails
closed rather than silently merging rows.

The active snapshot is the baseline. Auditable manual additions and removals
at or after its import time are then applied chronologically. Older manual
events remain historical but are reported as superseded by the newer snapshot.
When no snapshot exists, manual durable-ID additions can establish a private
registry with unknown freshness.

## Maiden state

Snapshot Maiden state preserves all four states:

- eligible;
- not eligible;
- unknown; and
- invalid source evidence.

An owner may explicitly override an active core to eligible, not eligible or
unknown. A manual override cannot manufacture an invalid source state and does
not itself prove ownership. Overrides for inactive cores remain warnings.

The registry records whether the effective state came from the snapshot, a
manual override or unresolved evidence. Future Maiden logic must continue to
apply the one-use preservation and commitment rules separately.

## Profile and freshness boundary

An active owned core without selected Core Details remains visible with a
`missing_core_details` warning. It is not dropped or silently treated as a
complete profile.

The registry exposes Current Vault `Data current through`, `Last imported`
and freshness separately. A recent import does not make an old snapshot current,
and a manual-only registry remains freshness-unknown.

## Audit and privacy

Every manual event requires a stable ID, effective timestamp and reason. The
domain projection is deterministic across input order and never contains names,
CSV rows, wallet values or economic records.

The repository uses synthetic IDs only. Hosted persistence, owner-only mutation
functions and the Vault interface are later focused slices. Production and
private uploads remain gated.

## Validation

Synthetic tests cover:

- confirmed versus proposed identity handling;
- manual-only setup;
- chronological add/remove projection;
- superseded pre-snapshot history;
- ME override precedence and inactive-core warnings;
- missing Core Details warnings;
- independent freshness timestamps;
- duplicate confirmed ownership rejection; and
- deterministic ordering.
