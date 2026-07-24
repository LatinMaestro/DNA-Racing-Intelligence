# Aggregate Source Profile

## Purpose and evidence boundary

This document records privacy-safe aggregate observations from the repository owner's
private source exports. It establishes import and product behaviour without placing
the source files or user-specific records in Git.

Only aggregate counts and owner-confirmed rules are permitted here. Do not commit:

- raw or transformed source files;
- source filenames or private checksums;
- core names or durable core identifiers;
- individual source records;
- fee, prize, arena or other monetary values; or
- user-specific derived profiles, recommendations, ledgers or exports.

Synthetic fixtures remain mandatory for repository tests.

## Authoritative source families

The inspected private source set contains nine exports across four source families:

| Source family | Export count | Import treatment |
| --- | ---: | --- |
| Race Merge history | 6 | Append sequential history, retain accepted prior facts and deduplicate exact boundary overlap |
| Core Details and lineage | 1 | Versioned upsert by authoritative durable core ID |
| Current Vault | 1 | Replace the current owned-core snapshot while retaining historical snapshot provenance |
| Current Arena | 1 | Replace the current listing snapshot while retaining historical snapshot provenance and freshness |

The legacy Bike-labelled details source is cross-mode Core Details. Its legacy
`bikeid` field maps to the authoritative durable core ID; it is not Bike-only
identity data.

## Privacy-safe aggregate profile

### Race history

- 2,536,710 race-entry records cover 695,901 events.
- 16,992 distinct durable core IDs appear in race history.
- The six exports are sequential rather than cumulative.
- Adjacent exports overlap at 13 boundary events.
- Those boundary events contain 67 exact duplicate entry records.
- No conflicting entry was observed in the inspected overlap.
- The importer must nevertheless quarantine any future conflicting overlap rather
  than overwriting an accepted fact.

### Core Details and lineage

- Core Details contains 18,127 unique durable core IDs.
- 14,181 cores have both recorded parents.
- 3,946 cores are founder or no-parent records in the supplied export.
- Every recorded parent ID resolves within the supplied Core Details set.
- Recorded parent-name provenance agrees with the referenced parent IDs.
- Fifteen exact core names are reused by more than one durable ID.

Durable IDs are authoritative. A name must never create or change lineage,
ownership or economic attribution by itself.

### Current Vault

- The current snapshot contains 195 owner-confirmed owned cores.
- 68 are marked Maiden Eligible.
- 127 are marked not Maiden Eligible.
- `me=true` means Maiden tournament eligible; it is not an ownership filter.
- All 195 current rows resolve deterministically to Core Details and agree with the
  supplied identity attributes.
- All 195 have imported race history.
- 166 owned cores have recorded parents and 29 are founder or no-parent records.

The current snapshot therefore requires no manual identity decision. Future
unmatched, inconsistent or genuinely ambiguous rows must still fail closed into
review rather than being guessed.

### Coverage gaps

| Coverage check | Matched | Source total | Explicit gap |
| --- | ---: | ---: | ---: |
| Raced core IDs present in Core Details | 14,830 | 16,992 | 2,162 |
| Current Arena IDs present in Core Details | 791 | 792 | 1 |
| Current Arena IDs with race history | 770 | 792 | 22 |
| Current owned cores present in Core Details | 195 | 195 | 0 |
| Current owned cores with race history | 195 | 195 | 0 |

The 2,162 raced IDs absent from the supplied Core Details export remain valid
performance evidence but must show attributes and lineage as unavailable. The 22
Arena IDs without race history require an explicit no-imported-racing-history
state. A later Core Details export may close coverage gaps by durable ID without
deleting accepted history.

## Historical BGC race exception

The inspected race history contains 998 entries across 467 events whose race asset
is BGC. The repository owner confirms these are exceptional historical races and
must be treated as free-entry, no-payout races for accounting.

For every Race Merge entry whose race asset is BGC:

- retain the race, mode, distance, gate, core, elapsed-time, position and star
  evidence;
- preserve source provenance only within the approved private data boundary;
- set the effective economic entry fee and payout to zero;
- create no race-derived ETH, DEZ or BGC ledger transaction;
- exclude the source fee and prize from every fee, payout, profit, loss,
  tournament-campaign and economic-completeness total; and
- do not create an economic review item merely because the historical race asset
  is BGC.

This exception does not change the separate BGC ledger for genuine manually
recorded breeding costs, arena spending, burn credits or other non-race BGC
activity.

## Downstream requirements

- Race Merge imports must accept sequential additions, exact replay and small
  boundary overlap idempotently.
- Current Vault and Current Arena remain replacement historical snapshots, never
  live state.
- Core Details and lineage must use durable IDs and retain partial-profile states.
- Ownership applies to every accepted current-Vault row; ME remains a separate
  eligible/not-eligible state.
- The current Vault snapshot may be resolved deterministically, while future
  unresolved identities remain review-required.
- Analytical validation may use the private exports only within approved hosted
  processing boundaries. Git may retain aggregate evidence only.
- Production remains disabled and the first persistent private hosted import
  remains subject to Gate B.
