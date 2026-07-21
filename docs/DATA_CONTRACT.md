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
- wallet/account labels; and
- external transaction references where supplied.

Do not combine currencies without an explicit conversion source and effective date.

Treat BGC as a separate asset type. Do not silently convert it into cash or crypto.

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

## Reconciliation and duplication

- Re-importing cumulative Race Merge data must not duplicate race or economic records.
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