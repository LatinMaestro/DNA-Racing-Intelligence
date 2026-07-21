# Data Contract and Import Requirements

## Input types

1. Race Merge CSV — cumulative or sequential race-entry history.
2. Core Details CSV — identity, lineage and core attributes.
3. Current Vault CSV — active owned cores and current ME state where available.
4. Current Arena CSV — time-sensitive externally available breeding listings.
5. Tournament configuration — manually entered structured rules.

## Import principles

- Detect file type from headers and explicit user selection.
- Validate required columns before persistence.
- Preserve an import batch record: filename, checksum, type, upload time, row counts, accepted/rejected counts, warnings and schema version.
- Deduplicate race entries using stable source identifiers, with `event_id + token/core_id` as the initial expected natural key where available.
- Imports must be idempotent.
- Never delete previously accepted history merely because a newer file omits it without an explicit reconciliation workflow.
- Support rollback of one import batch without corrupting prior batches.
- Store raw source values and normalized values separately where practical.
- Ignore race class in analytical models but preserve the source field for provenance if inexpensive.

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
- currencies;
- race time and speed units.

Do not combine currencies without an explicit conversion source and effective date.

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

## Privacy and repository rules

- Real CSVs, database dumps and derived user-specific exports must be gitignored.
- Tests use synthetic fixtures.
- Uploaded raw files must be private and access-controlled.
- Production logs must not print complete raw records, credentials or private file content.
