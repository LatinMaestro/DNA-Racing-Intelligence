# Data Contract and Import Requirements

## Input types

1. Race Merge CSV — cumulative or sequential race-entry history.
2. Core Details CSV — identity, lineage and core attributes.
3. Current Vault CSV — active owned cores and current ME state where available.
4. Current Arena CSV — time-sensitive externally available breeding listings.
5. Tournament configuration — manually entered structured rules.
6. Manual economic transaction — payout, fee, sale, purchase, burn, transfer, opening balance, adjustment or reconciliation entry.
7. Future authoritative economic export — only where the game or marketplace provides a supported transaction history.

The currently inspected private source set contains six sequential Race Merge exports and one export each for Core Details, Current Vault and Current Arena. Privacy-safe counts, overlap and coverage evidence are recorded in `docs/AGGREGATE_SOURCE_PROFILE.md`; exact filenames and source records remain outside Git.

## Import principles

- Detect file type from headers and explicit user selection.
- Validate required columns before persistence.
- Preserve an import batch record: filename, checksum, type, upload time, source date where available, latest accepted event time, row counts, accepted/rejected counts, warnings and schema version.
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
- gate count;
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
- Gold-star and Blue-star flags;
- Gold-star eligibility; and
- star-data completeness and validation status.

Do not combine currencies without an explicit conversion source and effective date.

Treat BGC as a separate asset type. Do not silently convert it into cash or crypto.

## Race star source fields

The Race Merge exports include:

- `gold_star` — the Gold star;
- `blue_star` — the Blue star.

Owner-confirmed meanings:

- Gold star: the core assessed by the game as having the strongest chance to finish in the top three in that entered field.
- Blue star: the core assessed by the game as having the strongest chance to win and finish first in that entered field.

Owner-confirmed Gold eligibility rule:

- Gold stars are not assigned in races with three gates or fewer.
- Derive `gold_star_eligible = gate_count > 3` unless a later owner-confirmed rule changes it.
- A false Gold value in a 1-, 2- or 3-gate race is structurally ineligible, not negative evidence.

Import requirements:

- preserve `gold_star` and `blue_star` raw values in staging or provenance storage;
- normalize both to nullable Booleans using the same Gold and Blue terminology;
- derive or persist `gold_star_eligible`;
- distinguish `false` from absent, blank, malformed or unavailable;
- record a `star_data_status` such as `complete`, `partial`, `missing` or `invalid`;
- never silently treat a missing column or value as `false`;
- preserve source batch and row provenance;
- validate event-level assignment counts for each star type;
- flag a source Gold assignment in a race with three gates or fewer as an anomaly;
- retain and flag anomalies rather than silently rewriting them.

Initial supplied data indicates that no event has more than one Gold or one Blue assignment. Treat that as an import validation expectation and observed source characteristic, not an immutable game rule beyond the confirmed Gold gate restriction.

The same core may receive both stars in one event and the model must support that state.

## Proposed normalized race-entry star fields

Each normalized race-entry record should support:

- `gold_star` nullable Boolean;
- `blue_star` nullable Boolean;
- `gold_star_eligible` Boolean;
- `gold_star_source_value` optional raw value;
- `blue_star_source_value` optional raw value;
- `star_data_status`;
- star validation warning code where applicable;
- import batch ID.

A derived event-level view or table should expose:

- event ID;
- gate count;
- Gold-star eligibility;
- whether a Gold star was assigned;
- Gold-star core ID where assigned;
- whether a Blue star was assigned;
- Blue-star core ID where assigned;
- whether the same core received both;
- event star validation status.

## Star aggregate requirements

Precomputed or efficiently queryable aggregates should support each core × mode × exact distance and broader profile levels:

- total races with valid star data;
- Gold-eligible races;
- Gold assignment-opportunity races;
- Blue assignment-opportunity races;
- Gold count and rate;
- Blue count and rate;
- both count and rate;
- Gold-only count and rate;
- Blue-only count and rate;
- neither count and rate where the relevant signals were genuinely available;
- rolling recent rates;
- rates by gate count and relevant historical format;
- rates by pre-race field-quality band;
- sample size, recency and confidence.

Where the UI shows a rate, store or calculate enough information to identify whether the denominator is:

1. all races with valid star data;
2. Gold-eligible races with more than three gates; or
3. only races where that star type was assigned to someone in the field.

Do not combine the denominators silently. Never include a 1–3 gate race as a negative Gold opportunity.

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

## Data freshness and snapshot status

Race data will normally be refreshed by a newer export every few days. It is not live data.

Persist for each accepted import and current dataset state:

- uploaded/imported timestamp;
- source filename and checksum;
- minimum and maximum accepted event timestamps;
- latest accepted event timestamp across the active dataset;
- source row count and accepted row count;
- derived data-age value or inputs;
- aggregate refresh completion time.

The application must expose:

- `Data current through` based on the latest accepted event time;
- `Last imported` based on import time;
- a freshness state such as current, ageing or stale;
- an explicit historical-snapshot label.

Do not describe periodic race, vault, core or arena data as live. Do not infer that events after the latest accepted timestamp did not occur.

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
- Every accepted Current Vault row represents an owned core; `me` is a separate Maiden-eligibility field and must never be used as the ownership filter.
- The inspected current snapshot resolves all 195 owner-confirmed rows deterministically to Core Details. Future unmatched, inconsistent or genuinely ambiguous identities remain review-required.
- Allow manual additions, removals and ME overrides.
- Burnt cores are absent from active vault data but remain in historical core and lineage records.
- Do not infer current ownership solely from race history.
- Display when the current-vault snapshot was last imported.

## Arena freshness

- Arena listings commonly last 5 or 10 days.
- Store listing import time and source expiry where available.
- Mark recommendations stale when the arena export is no longer current.
- Never silently recommend an expired listing.
- Never treat listing presence or expiry as evidence that a fee was earned.
- Never label imported arena listings as live.

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
- A newer import must update dataset freshness and recalculate affected aggregates safely.
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

## Owner-confirmed Race Merge economics

The Race Merge economic columns have these normalized meanings:

| Source column | Meaning                           | Normalized treatment                                                                                                       |
| ------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `rpayout`     | Payout format/mechanism label     | Preserve as a versionable label; never parse as an amount                                                                  |
| `rfee`        | Per-core race-entry fee           | Exact non-negative source decimal; create at most one entry-fee debit per accepted owned-core entry when greater than zero |
| `prize`       | Per-core gross race payout        | Exact non-negative source decimal; create at most one payout credit per accepted owned-core entry when greater than zero   |
| `toke_curr`   | Entry and payout asset            | Normalize ordinary race economics to ETH or DEZ; apply the confirmed historical BGC non-economic exception; other assets remain review-required |
| `r_tags`      | Race eligibility/restriction tags | Preserve raw text and parse only versioned, tested tag rules                                                               |

A numeric zero is an authoritative zero. Blank, missing, malformed and negative values are not equivalent to zero. The fee and prize use the same row asset. Race-derived natural keys remain the accepted race-entry key plus `entry_fee` or `payout`, so cumulative imports cannot duplicate them.

Persist exact source decimals and use exact database numerics; do not convert through JavaScript binary floating point. Entry fees are stored as expenses/debits and prizes as income/credits. Refunds, reversals and adjustments require an explicit source event or auditable manual entry.

### Historical BGC race exception

A Race Merge entry whose `toke_curr` is BGC remains accepted race-performance evidence but has an effective entry fee and payout of zero. It creates no race-derived transaction in ETH, DEZ or BGC, contributes no source fee or prize to an economic aggregate, and does not enter an unsupported-asset review queue merely because the race asset is BGC. Preserve its source provenance only inside the approved private import boundary.

This exception is limited to historical race economics. Genuine BGC breeding costs, arena spending, burn credits, opening balances and adjustments remain separate BGC-ledger activity.

### USD valuation

Race reports must preserve original ETH/DEZ values and also calculate a USD reporting value from a dated rate for the event's UTC calendar day.

Each valuation must retain:

- asset and original exact amount;
- UTC rate date;
- exact USD-per-asset rate;
- provider and provider-series identifier;
- retrieval time;
- source timestamp;
- valuation method;
- converted exact USD amount;
- status such as available, missing, stale, manually overridden or superseded; and
- correction/supersession history.

Use one canonical daily rate per asset and UTC date for all races on that date. The initial free provider is CoinGecko historical market data: coin ID `ethereum` for ETH and the Polygon contract-pinned DEZ series for `0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E`. Fetch rates only in the background import workflow, cache them durably and never make routine page requests depend on a third-party price API.

A missing provider rate must leave USD unavailable and visible; it must not silently use today's price, interpolate across a gap or substitute another asset. Manual rates and later corrections are auditable overrides, not destructive replacements.

BGC has an owner-confirmed USD 1 = BGC 1 reference rate. It remains a separate non-cash ledger and is excluded from ETH/DEZ operating P/L totals unless a separately labelled BGC-equivalent view is selected.
