# Vault Performance and Financial Ledger

## Purpose

The Vault Performance area provides a private operational view of how the user’s DNA Racing vault is performing financially and economically over time.

It must combine race-export evidence with user-entered transactions so the owner can track:

- normal open-racing entry fees and payouts;
- tournament qualification entry fees and race payouts;
- automatic tournament-round and grand-final race payouts;
- tournament awards paid manually by the game owner directly to a crypto wallet;
- arena breeding fees earned from other vaults using an owned core;
- breeding and arena fees paid;
- core sale proceeds and acquisition costs where recorded;
- BGC credits received from burning spliced cores;
- BGC credits spent on eligible arena fees; and
- adjustments required to reconcile incomplete or unusual source data.

This is a decision-support and vault-performance ledger. It is not intended to be tax, statutory accounting or financial-advice software.

## Core principles

1. **Separate source-derived and manual records.** Race-export values must remain traceable to their source row/event. User-entered payouts, sales, arena income and BGC movements must retain their own provenance.
2. **Do not double count.** A manual payout that later appears in an export must be flagged for reconciliation rather than silently counted twice.
3. **Keep currencies separate.** Do not combine DEZ, fiat, crypto tokens or other currencies without an explicit conversion rate and effective date.
4. **Treat BGC as non-cash game credit.** BGC received from burning a core is not cash or crypto income. It must be shown in a separate BGC ledger and balance.
5. **Allow mixed payment methods.** An arena fee may be paid partly in BGC and partly in another currency. Record each component separately.
6. **Distinguish realised activity from estimated asset value.** Initial reporting is transaction-based. Do not treat arena asking prices or modelled core values as realised profit.
7. **Make every classification auditable.** Tournament, stage, activity type and currency classifications must expose whether they came from source data, a rule, a user mapping or an inference.
8. **Never invent missing financial values.** Unknown amounts remain unknown until supplied or supported by source evidence.

## Activity categories

Every financial or economic ledger entry must be assigned to one primary activity category:

1. `OPEN_RACING`
   - ordinary open races outside a configured tournament qualification campaign;
2. `TOURNAMENT_QUALIFICATION`
   - paid or free races run during the user-controlled qualification stage;
3. `TOURNAMENT_ROUND`
   - game-auto-run rounds after qualification;
4. `TOURNAMENT_GRAND_FINAL`
   - game-auto-run grand-final race payouts recorded in race data;
5. `TOURNAMENT_MANUAL_AWARD`
   - an overall tournament prize or award sent manually by the game owner to a crypto wallet rather than paid through an individual race;
6. `ARENA_FEE_EARNED`
   - owner-nominated breeding fee earned when another vault uses an owned core;
7. `BREEDING_COST`
   - DNA base fee and external owner-nominated arena fees paid to create an offspring;
8. `CORE_SALE`
   - proceeds from selling a core;
9. `CORE_ACQUISITION`
   - purchase or mint cost for a core where the user chooses to record it;
10. `CORE_BURN_BGC`
    - BGC credits received from permanently burning a spliced core;
11. `BGC_ARENA_SPEND`
    - BGC used toward eligible arena fees;
12. `ADJUSTMENT`
    - explicit reconciliation or correction with a required reason.

Additional categories may be introduced through versioned migrations, but existing meanings must not be silently repurposed.

## Transaction directions and asset classes

Each ledger entry must identify:

- `INFLOW`, `OUTFLOW` or `NON_CASH_MOVEMENT`;
- asset/currency code;
- asset class:
  - fiat;
  - crypto;
  - game racing currency such as DEZ;
  - BGC game credit;
  - other explicitly defined asset;
- quantity/amount in original units;
- optional converted reporting value;
- conversion source and effective timestamp where conversion is used.

BGC entries always remain identifiable as BGC even if the user later assigns an indicative value for personal analysis.

## Race-derived ledger

The race import pipeline should derive owned-core ledger records from race-export fields where available.

For each owned core entry, retain:

- source import batch;
- source event ID and source row identity;
- race date/time;
- core ID;
- mode and distance;
- payout/format label;
- gate count where available;
- entry fee amount and currency;
- race payout amount and currency;
- inferred or mapped tournament;
- inferred or mapped bracket;
- inferred or mapped stage;
- paid/free status;
- classification confidence;
- net amount in the same native currency where entry fee and payout share a currency.

Do not infer a cross-currency net value without an explicit conversion.

### Tournament and stage classification

Race rows may not always contain a clean tournament identifier. The system must support:

- deterministic mappings from event labels/tags/date windows;
- user-created tournament date windows and event-pattern rules;
- manual correction of individual or bulk classifications;
- `UNCLASSIFIED` status where evidence is insufficient;
- reclassification with an audit history;
- confidence labels such as confirmed, rule-matched, inferred and manual.

The user must be able to define which race exports belong to:

- normal open racing;
- a named tournament qualification campaign;
- automatic rounds;
- a grand final; or
- another event type.

## Manual ledger entries

The website must provide a private manual-entry interface for financial events that are absent from exports.

Required manual entry types include:

- manual tournament award;
- arena fee earned;
- breeding fee paid;
- core sale;
- core acquisition or mint cost;
- BGC received from burn;
- BGC spent on arena fee;
- correction/adjustment.

### Common manual-entry fields

- effective date and time;
- activity category;
- direction;
- original amount;
- currency/asset code;
- asset class;
- optional reporting-currency conversion rate and source;
- linked core or cores;
- linked tournament, bracket and stage where relevant;
- linked offspring or breeding pair where relevant;
- notes;
- optional wallet transaction hash, receipt or external reference;
- provenance: manual;
- created and last-modified timestamps;
- reconciliation status.

### Manual tournament awards

A manual tournament award must support:

- named tournament and season;
- bracket;
- mode;
- award date;
- crypto or other currency received;
- amount;
- receiving wallet reference or optional transaction hash;
- linked qualifying/final core or cores;
- placement or award reason;
- allocation treatment:
  - attribute entirely to one core;
  - split by user-entered percentages/amounts across several cores;
  - attribute to the tournament/vault only without forcing a core allocation.

Core allocation is for performance reporting and must not change the original transaction total.

### Arena fee income

An active arena listing is not itself income. Income is recognised in this operational ledger only when the user records or later imports evidence that another vault used the core and paid the nominated fee.

Arena income entries should link to:

- owned core used;
- external breeding date;
- nominated owner fee received;
- currency;
- optional offspring ID if later known;
- optional external parent ID;
- arena listing snapshot where available.

### Breeding costs

Breeding-cost entries should separate:

- DNA base fee;
- external Parent 1 nominated fee;
- external Parent 2 nominated fee;
- BGC component used;
- other-currency component paid.

For owned parents, no owner-nominated arena fee is attributed to the user’s own core. The higher applicable DNA base fee remains the game fee under the confirmed breeding rules.

## BGC ledger

BGC must have its own account-style ledger and balance.

### BGC inflows

- credits received from burning a spliced core;
- manual corrections supported by a reason.

### BGC outflows

- BGC applied to arena fees;
- manual corrections supported by a reason.

### BGC reporting

Show:

- opening balance for the selected period;
- BGC earned from burns;
- BGC spent on arena fees;
- adjustments;
- closing BGC balance;
- linked burnt cores;
- linked breeding transactions funded by BGC.

BGC must not be included in cash/crypto profit by default. The website may separately show “arena fees offset using BGC” as an economic-use metric without claiming that the BGC receipt was cash income.

## Core sales, acquisitions and burn disposals

### Core sales

Track gross sale proceeds in the original currency. Where a reliable cost basis exists, optionally calculate realised gain/loss.

### Core acquisitions

Allow optional recording of:

- purchase or mint cost;
- fees;
- currency;
- acquisition date;
- source/reference.

### Bred-core cost basis

Where the user wants cost-basis reporting, permit breeding costs to be assigned to the resulting offspring. Do not fabricate a cost basis when historical breeding costs are unavailable.

### Burns

Burning is a permanent disposal of a spliced core and returns BGC rather than cash. Report separately:

- core burnt;
- burn date;
- BGC received;
- optional known core cost basis disposed;
- BGC recovery;
- unresolved cost basis where unknown.

Do not label BGC received as cash profit. If cost basis is unavailable, show the burn as a non-cash recovery event without calculating a gain or loss.

## Reconciliation and duplicate protection

Every ledger entry has a reconciliation state:

- `UNRECONCILED`;
- `MATCHED`;
- `POSSIBLE_DUPLICATE`;
- `CONFIRMED_DISTINCT`;
- `ADJUSTED`.

Potential matching signals include:

- tournament/event;
- core;
- date window;
- amount and currency;
- transaction hash/reference;
- race-export payout;
- manual entry type.

The system must never automatically delete a manual entry solely because a possible export match appears. It should present the possible duplicate and require a safe reconciliation decision.

Corrections should use reversal or adjustment records where practical rather than destructive edits that erase history.

## Profit and performance calculations

### Racing result

For a selected native currency:

- gross race payouts;
- less race entry fees;
- equals net racing result.

Report separately for:

- open racing;
- tournament qualification;
- tournament rounds;
- tournament grand finals;
- manual tournament awards.

Manual awards are included in tournament performance but remain separately visible from race-paid prizes.

### Broader vault activity

Show separate components:

- net open-racing result;
- net tournament qualification result;
- round/final race payouts;
- manual tournament awards;
- arena fees earned;
- breeding fees paid;
- core sale proceeds;
- optional realised core sale gain/loss where cost basis exists;
- core acquisition costs;
- BGC earned and spent, outside cash/crypto P&L;
- adjustments.

### Overall totals

Do not produce one misleading grand total across unrelated currencies. Provide:

1. native-currency totals by asset;
2. optional reporting-currency totals only for entries with valid conversions;
3. an “unconverted amount excluded” disclosure;
4. a separate BGC balance and activity summary.

## Reporting views

The Vault Performance area should support:

- current week, month, season, calendar year, custom date range and lifetime;
- summary by currency/asset;
- open racing versus tournament activity;
- qualification versus automatic rounds versus grand finals;
- manual tournament awards;
- core-by-core profitability;
- mode and distance;
- tournament, bracket and leaderboard;
- arena-fee income by owned core;
- breeding costs and BGC use;
- core sales and burns;
- transaction ledger with filters and export.

### Suggested dashboard metrics

- net open-racing result;
- qualification entry fees;
- qualification race payouts;
- qualification net result;
- automatic round/final race payouts;
- manual tournament awards received;
- combined tournament result;
- arena breeding fees earned;
- breeding fees paid;
- core sale proceeds;
- BGC earned, spent and current balance;
- best and worst core by realised racing result;
- data completeness/reconciliation warnings.

## Per-core financial profile

Each owned core profile should optionally show:

- open-racing fees, payouts and net result;
- tournament qualification fees, payouts and net result;
- round/final payouts;
- manually allocated tournament awards;
- arena fees earned;
- breeding costs attributable to the core or offspring where recorded;
- sale or burn outcome;
- native-currency totals and BGC activity;
- unclassified or unreconciled entries.

Financial results must not replace racing-time evidence when deciding whether a core is genuinely fast. They are an additional strategic dimension.

## Data quality and explainability

Every total must be drillable to ledger entries and source records.

Display warnings for:

- unknown currency;
- missing entry fee or payout;
- possible duplicate manual/export transaction;
- unclassified race activity;
- incomplete tournament date mapping;
- missing cost basis;
- stale or absent arena-income evidence;
- conversion rate missing or stale;
- partial dataset coverage.

## Initial non-goals

- tax return preparation;
- accounting-standard financial statements;
- automatic crypto-wallet monitoring;
- automatic exchange trading or currency conversion;
- automatic game transactions;
- treating modelled core values or arena asking prices as realised profit;
- assigning a cash value to BGC by default.

## Acceptance criteria

The module is complete only when:

- race entry fees and payouts for owned cores can be imported idempotently;
- open, qualification, round and final activity can be classified and corrected;
- manual tournament awards can be entered and linked without changing source race records;
- BGC burn receipts and arena-fee spending are tracked separately from cash/crypto P&L;
- arena income, breeding costs, sales and acquisitions can be recorded;
- mixed currencies are never silently combined;
- possible duplicate payouts are surfaced for reconciliation;
- every displayed total drills down to source or manual ledger entries;
- time-range, tournament and core filters work;
- tests cover classification, native-currency net calculations, BGC separation, manual award allocation and reconciliation safeguards;
- no real private financial or vault data is committed to Git.