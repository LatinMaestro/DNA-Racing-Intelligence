# Vault Performance and Accounting Specification

## 1. Purpose

The private website must include a **Vault Performance** area that tracks the economic performance of the user’s DNA Racing activity without confusing race performance, wallet balances, cash/crypto returns and non-cash game credits.

The module must support:

- normal open racing;
- tournament qualification racing;
- automated tournament rounds and finals;
- tournament prizes paid inside race results;
- tournament prizes paid manually by the game owner directly to a crypto wallet;
- breeding fees earned when other vaults use the user’s arena-listed cores;
- breeding costs paid to the game and external core owners;
- core purchase and sale activity;
- permanent core burns and BGC credits returned;
- manual corrections, adjustments and uncaptured transactions; and
- reporting by timeframe, tournament, core, mode, distance and transaction category.

The objective is an accurate, auditable view of vault operating performance and cashflow. It is not intended to operate a crypto wallet, provide tax advice or infer wallet balances from incomplete data.

## 2. Fundamental accounting principles

### 2.1 Currency-aware accounting

Every transaction must retain its original asset or currency.

Do not add unlike currencies or assets together without an explicit conversion rate and effective date.

Examples may include:

- DEZ or other game-linked race currencies;
- fiat-denominated race or breeding fees;
- crypto assets received in a wallet;
- BGC game credits; and
- any future game currency present in source exports.

The default reports must show separate totals by asset/currency.

An optional reporting-currency conversion may be added later. Any converted total must show:

- source asset and amount;
- conversion rate;
- rate source;
- effective date/time;
- converted amount; and
- whether the conversion is actual, manually supplied or estimated.

Never silently convert BGC to cash or crypto.

### 2.2 BGC treatment

BGC is an in-game credit rather than actual cash proceeds.

Confirmed use:

- burning an eligible spliced core may return BGC;
- BGC can be used to pay arena fees.

Requirements:

- maintain a separate BGC ledger;
- show BGC earned, spent and net movement;
- allow a manual opening BGC balance because complete historical activity may not be available;
- do not include BGC in cash/crypto profit by default;
- do not assign BGC a cash value unless the user explicitly supplies one;
- label any BGC-to-reporting-currency valuation as optional and estimated; and
- retain the associated core ID for burn-origin credits.

Burn-credit amounts change over time and are not to be predicted by the lifecycle model. The user manually records the actual BGC received after a burn.

### 2.3 Performance versus wallet balance

Race exports and manual entries can support activity profit/loss, but they may not establish the complete balance of a crypto wallet.

The website must distinguish:

- **activity P/L or cashflow** — income less expenses recorded by the application;
- **asset movement** — BGC earned/spent or currency inflow/outflow;
- **wallet transfer** — movement between locations that is not income or expense; and
- **wallet balance** — only shown where an opening balance and complete transaction history are available.

Deposits, withdrawals and internal wallet transfers must not be treated as profit.

### 2.4 Realised versus unrealised value

Initial reporting must focus on realised activity and recorded cashflow.

Do not include an estimated market value for unsold cores in profit/loss by default. Arena listings are offers, not reliable completed-sale values.

Future inventory valuation may be added as a separately labelled estimate, but must never be mixed silently into realised P/L.

## 3. Economic event model

Represent all economic activity through an auditable ledger. Each ledger entry must include, where applicable:

- unique transaction ID;
- source type;
- source import batch;
- source event or race ID;
- date and time;
- original asset/currency;
- signed amount or explicit debit/credit direction;
- category and subcategory;
- associated core ID(s);
- mode and distance;
- tournament, season, bracket and stage;
- race format and gate count;
- counterparty or source owner where known;
- external reference or transaction hash;
- notes;
- confidence or classification status;
- created/edited timestamps; and
- manual correction history.

Use immutable source-derived facts where practical and store manual categorisation or correction as a separate auditable layer.

## 4. Required categories

### 4.1 Racing income and expenses

Track at least:

- open-race entry fee;
- open-race payout;
- tournament-qualification entry fee;
- tournament-qualification race payout;
- tournament round race payout;
- tournament final race payout;
- manual tournament prize payout;
- race refund or adjustment; and
- unclassified race activity pending review.

A single race entry may create:

- one entry-fee expense; and
- one payout-income transaction, including a zero payout where useful for reconciliation.

Do not assume the export’s fee field is necessarily per-core until validated against representative data. Document and test the confirmed interpretation before production import.

### 4.2 Breeding income and expenses

Track at least:

- DNA base splice fee paid;
- external arena-owner fee paid;
- arena fee paid with BGC;
- arena fee paid with another asset/currency;
- breeding fee earned from another vault;
- refund or failed-splice adjustment; and
- optional resulting offspring cost basis.

The current arena export describes availability and nominated fees. It does **not** prove that a breeding transaction occurred. Do not infer breeding income merely because a core appeared in the arena.

Completed breeding fees earned or paid must come from:

- a future authoritative transaction export; or
- manual entry by the user.

Where a pairing produces an owned offspring, allow the user to assign the actual pairing costs to that offspring as acquisition cost basis.

### 4.3 Core lifecycle transactions

Track at least:

- core purchase cost;
- core mint cost, where relevant;
- core sale proceeds;
- marketplace or transaction fees;
- burn event;
- BGC received from burn;
- manual acquisition-cost adjustment; and
- other lifecycle income or expense.

A sale can show realised profit only where acquisition cost is known. Otherwise display sale proceeds and clearly state that realised gain/loss is unavailable.

A burn must remain linked to the historical core and family tree. It removes the core from active racing/breeding use but does not remove historical records.

Genesis cores cannot be burned.

### 4.4 Non-performance movements

Support:

- deposit;
- withdrawal;
- transfer between wallets/accounts;
- opening balance;
- manual reconciliation adjustment.

These entries may help reconcile balances but must be excluded from operating P/L unless explicitly classified otherwise.

## 5. Race-export derivation

Use race exports to derive entry fees and payouts where the source data is sufficiently reliable.

For every owned core race entry, attempt to derive:

- event date/time;
- event ID;
- core ID;
- mode;
- distance;
- event/race format label;
- entry fee and asset/currency;
- payout/prize and asset/currency;
- race time and speed;
- finish position;
- gate count or field context; and
- tournament/stage classification where possible.

Imports must be idempotent. Re-importing a cumulative Race Merge export must not duplicate economic transactions.

Use the same stable natural key as the accepted race history where possible, with transaction-type suffixes for entry fee and payout.

## 6. Race and tournament classification

### 6.1 Primary racing segments

Every race should be classified, where possible, as:

1. normal open racing;
2. tournament qualification;
3. automated tournament round;
4. tournament final; or
5. unknown/unclassified.

### 6.2 Classification inputs

Classification may use:

- source event tags or format labels;
- event IDs;
- tournament date window;
- mode and distance;
- entry fee;
- gate count;
- user-configured bracket rules;
- known stage labels;
- known points/scoring context; and
- manual user confirmation.

The system must show the basis and confidence of an inferred classification.

Do not force uncertain races into a category. Preserve an unclassified review queue.

### 6.3 Tournament campaign linking

Allow a configured tournament to define one or more campaign windows and stages.

The user must be able to:

- link imported races to a tournament and bracket;
- unlink an incorrect match;
- bulk confirm a proposed classification;
- classify qualification, round and final stages;
- record a manual tournament payout; and
- correct the attribution without altering raw imported race facts.

A tournament may have multiple element, breed, F-number or mixed leaderboards and multiple qualification brackets. Economic reporting must preserve those distinctions where the data is known.

## 7. Manual tournament payouts

Some overall tournament prizes are paid manually by the game owner directly to crypto wallets rather than through an individual race result.

The website must provide a manual payout form with:

- payout date/time;
- tournament and season;
- bracket and leaderboard, where relevant;
- tournament stage or overall prize;
- amount;
- asset/currency;
- receiving wallet/account label;
- associated core or cores, if attributable;
- external transaction reference or crypto transaction hash, optional;
- evidence/notes; and
- allocation method.

Allocation options should include:

- leave unallocated at tournament/vault level;
- attribute entirely to one core;
- split equally between selected cores;
- split by manually entered percentages or amounts; and
- split using a documented points/race contribution method.

Do not require artificial core allocation where the reward is genuinely a vault-level or tournament-level prize.

## 8. Duplicate and reconciliation controls

Manual payouts may duplicate a prize already represented in race exports. Breeding and sale transactions may also be entered more than once.

The module must:

- warn about same-date, same-amount and same-currency potential duplicates;
- use external references/transaction hashes where supplied;
- display source provenance;
- support mark-as-duplicate/excluded without deleting history;
- allow reconciliation notes;
- support reversal/correction entries rather than silent mutation of accepted source facts; and
- prevent aggregate double counting.

## 9. Required performance views

### 9.1 Vault Performance dashboard

Show, for the selected timeframe:

- open-racing entry fees;
- open-racing payouts;
- open-racing net;
- qualification entry fees;
- qualification race payouts;
- qualification net;
- rounds/finals race payouts;
- manual tournament prizes;
- total tournament net;
- breeding fees earned;
- breeding fees paid;
- breeding net cashflow;
- core sale proceeds;
- core purchase costs;
- realised core-trading result where cost basis exists;
- BGC earned;
- BGC spent;
- net BGC movement;
- total recorded cashflow by asset/currency; and
- unclassified or unreconciled transaction count.

### 9.2 Tournament campaign view

For each tournament show:

- qualification races and entry fees;
- qualification race payouts;
- automated round/final race payouts;
- manual external tournament payout;
- net campaign result by asset/currency;
- participating cores;
- qualification bracket and leaderboard;
- races and payouts by core where attributable;
- source coverage and classification confidence; and
- unresolved transactions.

Profit/loss is not the only tournament objective. Display economic result alongside qualification and tournament-performance outcomes without allowing financial performance to override the balanced product strategy.

### 9.3 Core economic profile

For an owned or historically owned core show:

- racing entry fees and payouts by mode/distance;
- tournament campaign contributions;
- breeding fees earned;
- breeding expenses attributed to the core;
- acquisition cost where known;
- sale proceeds where applicable;
- burn event and BGC returned;
- realised result where supportable; and
- unallocated shared rewards clearly separated.

Do not allocate all vault-level tournament rewards to a core merely to make a per-core P/L complete.

### 9.4 Time and grouping filters

Support at least:

- custom date range;
- week;
- month;
- season;
- calendar year;
- mode;
- exact distance;
- distance band;
- transaction category;
- tournament;
- bracket;
- core;
- element;
- class/breed; and
- asset/currency.

## 10. Profit and cashflow definitions

Use clearly labelled calculations.

### 10.1 Open Racing Net

Open-race payouts minus open-race entry fees, per asset/currency.

### 10.2 Qualification Net

Qualification-race payouts minus qualification entry fees, per asset/currency.

### 10.3 Tournament Campaign Net

Qualification payouts plus round/final race payouts plus manual tournament prizes minus qualification entry fees and any manually recorded tournament-specific expenses.

### 10.4 Breeding Net Cashflow

Breeding fees earned minus DNA base fees and external arena fees paid, per asset/currency.

BGC expenditure must remain visible separately unless an explicit valuation is provided.

### 10.5 Core Trading Result

Sale proceeds minus known acquisition cost and recorded selling fees.

Where cost basis is missing, show proceeds only and mark result unavailable.

### 10.6 Total Recorded Vault Cashflow

All recorded operating income minus all recorded operating expenses, grouped by asset/currency and excluding deposits, withdrawals and internal transfers.

Do not describe this as complete lifetime profit where historical records are incomplete.

## 11. Reporting completeness and confidence

Every report must state:

- date coverage;
- imported source coverage;
- manual transaction coverage;
- number of unclassified records;
- currencies/assets included;
- whether any conversion was used;
- whether acquisition costs are missing;
- whether manual final payouts have been entered; and
- whether the result is complete, partial or estimated.

Examples:

- `Complete for imported race activity; external tournament payouts not confirmed.`
- `Partial core-sale result: acquisition cost unavailable.`
- `BGC movement only; BGC is not included in cash profit.`

## 12. User entry and correction experience

Provide a simple private ledger interface to:

- add income, expense, transfer, opening balance or adjustment;
- select category and asset/currency;
- link cores and tournaments;
- record external references;
- edit categorisation and notes;
- reverse an incorrect manual entry;
- review import-derived proposed classifications; and
- resolve duplicate warnings.

Changes must be auditable and recoverable.

## 13. Data model guidance

The final architecture may refine naming, but should preserve concepts equivalent to:

- `EconomicTransaction`;
- `TransactionAllocation`;
- `AssetCurrency`;
- `WalletOrAccount`;
- `TournamentCampaign`;
- `RaceEconomicClassification`;
- `ManualPayoutEvidence`;
- `CoreCostBasis`; and
- `ReconciliationIssue`.

Transactions should use exact decimal or integer minor-unit storage suitable for the source asset. Never use binary floating point for money or token amounts.

## 14. Privacy and security

- All economic data is private.
- Do not log full wallet addresses, transaction references or raw imported rows unnecessarily.
- Allow wallet/account labels without requiring a complete public address.
- Never request or store private keys, seed phrases or signing credentials.
- The website is read/write for records only and must not initiate blockchain or game transactions.
- Production remains gated.

## 15. Validation and testing

Use synthetic fixtures to test:

- race entry fee and payout derivation;
- cumulative import deduplication;
- open/qualification/round/final classification;
- manual final payout entry;
- potential duplicate detection;
- BGC burn credit and BGC arena-fee spend;
- multi-currency separation;
- optional conversion labelling;
- core sale with and without cost basis;
- exclusion of wallet transfers from P/L;
- tournament campaign aggregation;
- manual correction and reversal;
- incomplete-data warnings; and
- no private data in Git or logs.

## 16. Delivery integration

This document is an additive source of truth alongside the master specification.

Implementation sequencing:

- Phase 0 architecture must account for a currency-aware auditable ledger and manual transaction entry.
- Phase 1 data foundation must create the economic transaction/import foundations and race-derived transaction pipeline.
- Phase 2A must deliver the core Vault Performance dashboard, ledger, BGC tracking and manual entry.
- Phase 4 tournament work must add bracket/stage attribution and tournament campaign reporting.
- Breeding and lifecycle phases must integrate actual breeding income/expenses, core sales and burns.
- Validation must include reconciliation and multi-currency accounting controls.

Where this document adds requirements not yet listed in `docs/MASTER_SPECIFICATION.md`, these requirements are approved and must not be omitted.