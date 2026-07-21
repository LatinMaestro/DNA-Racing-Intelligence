# Data Contract and Import Requirements

## Input types

1. Race Merge CSV — cumulative or sequential race-entry history.
2. Core Details CSV — identity, lineage and core attributes.
3. Current Vault CSV — active owned cores and current ME state where available.
4. Current Arena CSV — time-sensitive externally available breeding listings.
5. Tournament configuration — manually entered structured rules.
6. Manual economic transaction — payout, fee, sale, purchase, burn, transfer, opening balance, adjustment or reconciliation entry.
7. Future authoritative economic export — only where the game or marketplace provides a supported transaction history.

## Import principles

- Detect file type from headers and explicit user selection.
- Validate required columns before persistence.
- Preserve an import batch record: filename, checksum, type, upload time, row counts, accepted/rejected counts, warnings and schema version.
- Deduplicate race entries using stable source identifiers, with `event_id + token/core_id` as the initial expected natural key where available.
- Derive race economic transactions idempotently from the accepted race-entry natural key plus transaction type.
- Imports must be idempotent.
- Never delete previously accepted history merely because a newer file omits it without an explicit reconciliation workflow.
- Support rollback of one import batch without corrupting prior batches.
- Store raw source values and normalized values separately where practical.
- Ignore race class in analytical models but preserve the source field for provenance if inexpensive.
- Preserve manually entered economic transactions separately from source-derived transactions.
- Corrections to accepted economic facts must use auditable overrides, exclusions, reversals or reconciliation records rather than silent destructive mutation.

## Normalisation

Normalize without losing source values:

- core IDs;
- names and casing;
- mode;
- distance;
- breed/class;
- element;
- F-number;
- sex;
- event and payout labels;
- timestamps and time zones;
- currencies and asset identifiers;
- transaction direction and category;
- race time and speed units;
- tournament, bracket and stage identifiers;
- wallet/account labels;
- external transaction references where supplied;
- Yellow-star and Blue-star flags; and
- star-data completeness and validation status.

Do not combine currencies without an explicit conversion source and effective date.

Treat BGC as a separate asset type. Do not silently convert it into cash or crypto.

## Race star source fields

The Race Merge exports currently include:

- `gold_star` — the source field for the user-facing **Yellow star**;
- `blue_star` — the source field for the **Blue star**.

Owner-confirmed meanings:

- Yellow star: the core assessed by the game as having the strongest chance to finish in the top three in that entered field.
- Blue star: the core assessed by the game as having the strongest chance to win and finish first in that entered field.

Import requirements:

- preserve `gold_star` and `blue_star` raw values in staging or provenance storage;
- normalize `gold_star` to domain field `yellow_star`;
- normalize both to nullable Booleans;
- distinguish `false` from absent, blank, malformed or unavailable;
- record a `star_data_status` such as `complete`, `partial`, `missing` or `invalid`;
- never silently treat a missing column or value as `false`;
- preserve source batch and row provenance;
- validate event-level assignment counts for each star type;
- retain and flag anomalies rather than silently rewriting them.

Initial supplied data indicates that no event has more than one Yellow or one Blue assignment. Treat that as an import validation expectation and observed source characteristic, not an immutable game rule.

The same core may receive both stars in one event and the model must support that state.

## Proposed normalized race-entry star fields

Each normalized race-entry record should support:

- `yellow_star` nullable Boolean;
- `blue_star` nullable Boolean;
- `yellow_star_source_value` optional raw value;
- `blue_star_source_value` optional raw value;
- `star_data_status`;
- star validation warning code where applicable;
- import batch ID.

A derived event-level view or table should expose:

- event ID;
- whether a Yellow star was assigned;
- Yellow-star core ID where assigned;
- whether a Blue star was assigned;
- Blue-star core ID where assigned;
- whether the same core received both;
- event star validation status.

## Star aggregate requirements

Precomputed or efficiently queryable aggregates should support each core × mode × exact distance and broader profile levels:

- total races with valid star data;
- Yellow assignment-opportunity races;
- Blue assignment-opportunity races;
- Yellow count and rate;
- Blue count and rate;
- both count and rate;
- Yellow-only count and rate;
- Blue-only count and rate;
- neither count and rate;
- rolling recent rates;
- rates by gate count and relevant historical format;
- rates by pre-race field-quality band;
- sample size, recency and confidence.

Where the UI shows a rate, store or calculate enough information to identify whether the denominator is:

1. all races with valid star data; or
2. only races where that star type was assigned to someone in the field.

Do not combine the two silently.

## Pre-race field context

Historical star strength must be assessed against the quality of the entered field using information available before the event start time.

Derived field-quality features may use opponents’ prior:

- mode-distance time distributions;
- successful-time percentiles;
- star profiles;
- sample sizes;
- recency-weighted form; and
- lineage evidence available before the event.

The following must not enter a historical event’s pre-race field-quality calculation:

- the event’s eventual finishing positions;
- the event’s times;
- the event’s prizes or payouts;
- any later race result.

Persist a feature timestamp or cutoff reference sufficient to audit no-leakage behavior.

## Economic transaction requirements

Every economic transaction must retain:

- unique stable identifier;
- source type and source provenance;
- transaction date/time;
- original asset/currency;
- exact amount and debit/credit direction;
- category and subcategory;
- tournament/core/race links where applicable;
- manual or inferred classification status;
- duplicate/exclusion status;
- notes and external reference where supplied; and
- created/edited/reversed audit metadata.

Use exact decimal/numeric storage or integer minor units appropriate to each asset. Never use binary floating point for monetary, token or BGC amounts.

Imported race entries may derive separate entry-fee expense and payout-income records. Validate whether the source fee is per-core before treating it as such in production data.

## Economic classification

Race economic activity may be classified as:

- normal open racing;
- tournament qualification;
- automated tournament round;
- tournament final; or
- unknown/unclassified.

Classification may be inferred from event labels, configured tournament windows and rules, but uncertain matches must remain reviewable and correctable.

Arena listings do not represent completed breeding transactions. Do not create breeding income from a listing alone.

Manual tournament payouts sent directly to a crypto wallet must be supported as a separate source type and linked to the applicable tournament without requiring per-core allocation.

## Ownership

- Current Vault is the source of truth for active owned cores at import time.
- Allow manual additions, removals and ME overrides.
- Burnt cores are absent from active vault data but remain in historical core and lineage records.
- Do not infer current ownership solely from race history.

## Arena freshness

- Arena listings commonly last 5 or 10 days.
- Store listing import time and source expiry where available.
- Mark recommendations stale when the arena export is no longer current.
- Never silently recommend an expired listing.
- Never treat listing presence or expiry as evidence that a fee was earned.

## Lineage graph

Construct parent-child relationships from core details.

Derived relationships:

- parents;
- grandparents;
- full siblings;
- half siblings;
- offspring;
- wider lineage.

Validate family restrictions before a pairing recommendation.

Star profiles may be joined to lineage research as historical features, but the data layer must not label them as inherited traits without validated analysis.

## Reconciliation and duplication

- Re-importing cumulative Race Merge data must not duplicate race, star or economic records.
- Star aggregates must derive from the deduplicated accepted race-entry set.
- Warn about manual transactions with matching date, amount, asset and tournament/reference.
- Permit mark-as-duplicate or excluded status without deleting provenance.
- Support reversal entries for incorrect manual records.
- Exclude deposits, withdrawals and internal transfers from operating P/L.
- Preserve opening balances separately from income.
- Allow unclassified records to remain in a review queue.

## Privacy and repository rules

- Real CSVs, database dumps, wallet activity and derived user-specific exports must be gitignored.
- Tests use synthetic fixtures.
- Uploaded raw files must be private and access-controlled.
- Production logs must not print complete raw records, credentials, private file content, complete wallet addresses or transaction references unnecessarily.
- Never request or store private keys, seed phrases or signing credentials.
