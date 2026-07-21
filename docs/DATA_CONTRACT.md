# Data Contract and Import Requirements

## Input types

1. Race Merge CSV — cumulative or sequential race-entry history.
2. Core Details CSV — identity, lineage and core attributes.
3. Current Vault CSV — active owned cores and current ME state where available.
4. Current Arena CSV — time-sensitive externally available breeding listings.
5. Tournament configuration — manually entered structured rules.
6. Manual financial ledger entries — tournament awards, arena income, breeding costs, core transactions, BGC movements and adjustments not present in exports.

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
- Imported financial amounts must retain source currency/asset, direction and source-row provenance.

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
- currencies and asset codes;
- race time and speed units;
- tournament, bracket and stage classifications;
- financial activity category and transaction direction.

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
- An arena listing is not evidence that a breeding fee was earned. Arena income requires a supported transaction or manual ledger record.

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

## Financial ledger record contract

Race-derived and manual financial records must use a common auditable ledger model while retaining their different provenance.

Minimum fields:

- stable ledger entry ID;
- source type: race import, manual entry, adjustment or future approved integration;
- source import batch and source row/event identity where applicable;
- effective date/time and time zone;
- activity category;
- direction: inflow, outflow or non-cash movement;
- original amount using decimal-safe storage;
- currency/asset code;
- asset class: fiat, crypto, game racing currency, BGC or other;
- linked core/core IDs where applicable;
- linked tournament, bracket and stage where applicable;
- linked breeding pair or offspring where applicable;
- optional wallet transaction hash or external reference;
- classification provenance and confidence;
- reconciliation state;
- created/updated timestamps;
- optional notes;
- optional reporting-currency amount, rate, rate source and effective date.

### Financial activity categories

Support at least:

- open racing;
- tournament qualification;
- tournament round;
- tournament grand final;
- manual tournament award;
- arena fee earned;
- breeding cost;
- core sale;
- core acquisition;
- core burn BGC;
- BGC arena spend;
- adjustment.

### Race-derived financial records

Where present, import for each owned-core race entry:

- entry fee and currency;
- payout and currency;
- event and core identifiers;
- mode, distance, gate and format context;
- paid/free status;
- tournament/stage mapping and confidence.

Entry fee and payout may be netted only when they share the same native currency/asset.

### Manual financial records

The user must be able to enter transactions absent from exports, especially:

- overall tournament prizes sent directly to a crypto wallet;
- arena breeding fees earned;
- breeding fees paid;
- core sales and acquisitions;
- actual BGC received from burns;
- BGC spent on arena fees;
- supported adjustments.

Manual tournament awards may be allocated to one core, split across several cores, or retained at tournament/vault level. Allocation must not change the original transaction total.

### BGC rules

- BGC is a separate non-cash game-credit asset.
- BGC receipts and spending must maintain a dedicated running balance.
- Do not include BGC in cash/crypto P&L by default.
- A mixed BGC/other-currency arena payment must create separate ledger components.
- Do not assign a cash value to BGC without an explicit user-entered valuation and effective date.

### Reconciliation

Reconciliation states:

- unreconciled;
- matched;
- possible duplicate;
- confirmed distinct;
- adjusted.

Use tournament/event, core, date, amount, currency and transaction reference as matching signals. Never silently delete a manual record because a possible export match appears. Preserve correction history through reversals or adjustments where practical.

## Privacy and repository rules

- Real CSVs, database dumps, wallet details and derived user-specific exports must be gitignored.
- Tests use synthetic fixtures.
- Uploaded raw files and manual financial records must be private and access-controlled.
- Production logs must not print complete raw records, credentials, wallet references or private file content.
- Test fixtures must use invented core IDs, events, wallet references and amounts.