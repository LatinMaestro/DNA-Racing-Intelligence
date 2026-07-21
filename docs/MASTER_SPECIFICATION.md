# DNA Racing Intelligence — Master Product Specification

## 1. Product purpose

DNA Racing Intelligence is a private, single-user analytics and decision-support website for improving the owner’s DNA Racing vault.

It must convert historical race results, core metadata, current vault holdings, current arena listings, user-entered tournament parameters and user-entered financial records into practical recommendations and auditable vault-performance reporting. The system is advisory. It does not connect to the game, enter races, purchase splices, sell cores or burn cores.

The product objective is balanced across:

- tournament success;
- DEZ or other financial performance where relevant;
- discovery of elite racers;
- long-term vault quality;
- breeding quality and rare exceptional-offspring potential;
- coverage across modes, distances, elements, breeds and leaderboard groups; and
- disciplined retention, sale and burn decisions.

No single objective permanently overrides the others. Recommendations must show the trade-off where objectives conflict.

## 2. Users, access and privacy

- One user: the repository owner.
- Authentication is required.
- No public pages, public profiles, public recommendations or public API.
- Disable search indexing.
- Keep source exports, processed data, models and financial records private.
- Do not commit real exports, database snapshots, wallet details or private ledger records to GitHub.
- Build and operate online through GitHub, Codex, Vercel and managed data services.
- The user should not need to run the application locally.

## 3. Source datasets

The initial supplied exports and records include:

- cumulative or sequential race-merge CSV exports;
- core-details CSV export;
- current-vault CSV export;
- current-arena/splicing CSV export;
- season/tournament calendars and rule screenshots; and
- manual financial records for items not captured in exports, including overall tournament awards, arena income, core transactions and BGC movements.

Initial exploration identified approximately 2.5 million race-entry rows, about 695,000 events, approximately 18,000 core records, a current vault of roughly 68 cores and hundreds of active arena listings. Treat these figures as initial observations, not hardcoded assumptions.

The user will periodically upload newer versions. Imports must be incremental, idempotent, validated and auditable.

## 4. Core product modules

### 4.1 Private home dashboard

Show:

- current vault summary;
- active ME inventory;
- upcoming configured tournaments;
- highest-priority discovery actions;
- current arena opportunities;
- breeding recommendations;
- cores requiring lifecycle decisions;
- current-period racing and tournament financial summary by native asset;
- BGC balance/activity summary;
- financial reconciliation or unclassified-activity warnings; and
- data freshness and import warnings.

### 4.2 Vault registration and ownership lock

Allow the user to establish and maintain the active vault using core ID and name.

Requirements:

- import current-vault CSV;
- manually add or remove owned cores;
- manually confirm or override ME status;
- link owned IDs to core details, race results, family tree and ledger records;
- retain historical ownership/import provenance;
- assume owned active cores are available for breeding unless marked unavailable;
- do not include burnt cores in active-vault recommendations;
- preserve burnt cores in historical lineage and financial history.

### 4.3 Core profiles

Every known core profile should provide:

- identity, name, class/breed, element, F-number and sex;
- active ownership and ME state;
- parents, grandparents, siblings, offspring and wider lineage;
- mode-specific performance for bike, car and horse;
- exact-distance performance;
- sprint, middle and marathon summaries;
- best, median and average time;
- speed metrics;
- time variance and consistency;
- exceptional-run and poor-run frequency;
- historical successful-time benchmarks;
- sample sizes and confidence;
- tournament suitability;
- discovery status;
- breeding value;
- attributable racing fees, payouts, arena income and other recorded financial activity; and
- lifecycle recommendation.

Ignore the obsolete race-class field.

### 4.4 Performance benchmark library

For each mode, exact distance, gate count and relevant historical format, calculate:

- winning-time distribution;
- in-the-money time distribution;
- best-time percentile thresholds;
- median-time percentile thresholds;
- average-time distribution;
- variance and tail behaviour;
- field-strength-adjusted comparisons where feasible;
- recency and sample coverage.

Primary performance direction:

- lower elapsed time is better;
- higher speed is better;
- user-facing normalized scores are always higher-is-better.

Do not initially assume that payout format changes a core’s intrinsic racing ability. Use format to determine what characteristics matter, then test later whether format itself has independent predictive value.

### 4.5 Discovery section

Purpose: identify promising but under-tested core × mode × distance combinations without wasting races.

Rules:

- 10 completed races at an exact core × mode × distance is the minimum for a minimally analytical result.
- Fewer than 10 can support a hypothesis but not a confident conclusion.
- Do not test every mode or distance randomly.
- Use historical evidence in this order:
  1. core’s own results;
  2. parents;
  3. grandparents;
  4. full siblings;
  5. half siblings;
  6. offspring;
  7. wider lineage;
  8. general breed, element and F-number patterns.
- Permit limited probes for unexpected outlier or “supernatural” performance.
- Stop poor hypotheses early when direct and lineage time evidence is weak.
- Do not calculate lifetime races remaining.

Discovery outputs:

- recommended mode and exact distance;
- current sample count;
- additional races to reach 10;
- lineage rationale;
- historical successful-time comparison;
- recommended initial probe size;
- stop/continue threshold;
- strategic value, including upcoming tournament relevance;
- confidence;
- modes/distances not worth prioritising.

Distance bands:

- sprint: 900–1400;
- middle: 1400–1800;
- marathon: 1800–2200.

Boundary and adjacent-distance evidence may inform predictions, but exact-distance evidence has greatest weight. Strong cores may be suitable across several distances.

### 4.6 Tournament configuration

The user must be able to define a tournament and one or more qualification brackets without code changes.

Configurable fields include:

- name and season;
- qualification dates;
- mode;
- eligible distances;
- gate count;
- entry fee and currency;
- race format;
- eligible breeds/classes;
- eligible elements;
- eligible F-number values or ranges;
- combined groups such as Metal + Fire and Earth + Water;
- leaderboard split dimension;
- minimum race count;
- ranking metric;
- qualifying percentage or count;
- points table;
- shared versus separate qualifying races across brackets;
- whether a rule is confirmed or uncertain;
- notes and source evidence;
- race label/date/tag matching rules for Vault Performance classification.

Ranking metrics must support at least:

- fastest single time;
- median time;
- average time;
- points;
- wins;
- top-X finishes;
- best finish;
- manually defined scoring.

### 4.7 Tournament qualification optimiser

Focus on the user-controlled qualification stage. Later rounds and finals are auto-run by the game.

Outputs:

- ranked eligible cores by bracket and leaderboard;
- intended qualification objective for each core;
- candidate core set for Auto-Entry;
- suggested initial race count per core;
- stop, pause or continue rules;
- strongest reserve cores;
- expected qualification competitiveness;
- confidence and evidence gaps;
- warning where live gate occupancy could cause the user’s cores to race one another.

A vault may fill no more than 50% of race gates. Treat this only as a cap. Do not recommend filling the cap. The user will manage live occupancy and prefers outside users to fill most gates to reduce qualification loss risk.

### 4.8 Maiden Eligible strategy

ME is a one-use strategic opportunity.

The system must:

- allow manual ME confirmation;
- compare every ME core across bike, car and horse;
- preserve ME for the strongest credible mode-specific Maiden;
- recommend against the first available Maiden where another mode is stronger;
- support a core targeting only one of multiple shared qualification brackets;
- show commitment warnings before the first qualifying race;
- track planned, committed and consumed status.

Confirmed lifecycle:

- newly bred cores begin ME;
- newly minted Genesis cores may also be ME;
- a core that enters at least one Maiden qualification race is committed to that event;
- it retains the visible ME tag through qualification, rounds and grand final;
- it loses ME when that Maiden event concludes, even if it did not meet the minimum races or qualify;
- a core that enters no qualifying race retains ME for a later Maiden.

Maiden recommendation statuses:

- enter this Maiden;
- preserve ME for Bike;
- preserve ME for Car;
- preserve ME for Horse;
- more discovery required;
- no clear Maiden advantage.

### 4.9 Horse Maiden example template

Support the recent example as a reusable template, not a universal fixed rule.

Top 2 bracket:

- horse;
- all distances;
- 4-gate paid qualifying races, approximately $0.01 entry;
- element-separated leaderboards;
- fastest single time;
- minimum one race;
- top 70% qualify;
- later rounds approximately 8 gates with top two advancing;
- 12-gate grand final over seven races;
- final points: 10, 9, 8, 7, 6, 4, 4, 4, 4, 3, 2, 1.

Double Up bracket:

- same general qualifying context;
- element-separated leaderboards;
- median time;
- minimum nine races;
- top 70% qualify;
- later rounds 6–12 gates with top half advancing;
- 12-gate grand final over seven races;
- final points: 3.58, 3.46, 3.32, 3.17, 3.00, 2.81, then zero for 7th–12th.

Whether the same qualifying races count for both brackets may vary or remain uncertain. Configuration must support shared, separate and unknown.

### 4.10 Auto-Entry planner

The game permits the user to select multiple eligible cores and a repeated race count.

The website should recommend:

- which cores to select;
- intended bracket for each;
- initial number of races;
- minimum required races;
- when another attempt has meaningful expected value;
- when to stop due to weak times or diminishing qualification improvement;
- cores to hold in reserve.

It must not attempt to operate the game or promise exact live gate control.

### 4.11 Breeding intelligence

The breeding system must support owned-owned, owned-arena and arena-arena comparisons, although owned cores are assumed available and external cores must be active in the latest arena export.

Provide three independent rankings:

1. highest estimated offspring quality and exceptional-upside potential;
2. best vault-gap and leaderboard improvement;
3. best balanced pairing.

Never suppress a high-upside pairing merely because the vault already contains similar mode, distance, element or class coverage.

Assess:

- parent mode and distance time profiles;
- parent best, median and variance;
- parents, grandparents, siblings and offspring;
- class combination;
- element outcome;
- F-number outcome;
- sex and breeding availability;
- remaining lifetime splices where available;
- breed cycle availability where available;
- family restrictions;
- arena freshness and fees;
- historical parent-to-offspring associations;
- probability and uncertainty of weaker, similar, stronger and rare exceptional offspring;
- vault coverage gaps.

The hidden breed-quality formula is unknown. Investigate it using historical data and chronological backtesting, but report predictive associations and lift rather than claiming certainty.

### 4.12 Arena scanner

Use the latest active arena export to identify external breeding candidates.

Show:

- listing freshness and expiry if available;
- owner-nominated fee;
- DNA base fee;
- total pairing cost under confirmed fee rules;
- lineage and historical racing evidence;
- pair eligibility;
- predicted offspring class, element and F-number;
- elite-upside, vault-fit and balanced scores.

### 4.13 Lifecycle and burn adviser

Recommendations:

- race;
- discover;
- reserve for Maiden;
- breed;
- hold;
- sell;
- burn.

Rules:

- Genesis cannot be burned.
- All spliced classes may be burned.
- Burning is permanent.
- Burnt cores remain in historical family trees.
- Do not predict burn-credit value for the recommendation.
- Actual BGC received may be recorded after the burn in Vault Performance.
- Prioritise overall vault quality, not burn-credit return.
- Protect unresolved ME, specialist, discovery, lineage and breeding value.

### 4.14 Open Race tool

Secondary manual tool. Allow entry of:

- mode;
- distance;
- gate count;
- format;
- eligibility restrictions;
- already entered opposing core IDs;
- available places.

Output:

- recommended owned core;
- expected time and finish distribution;
- strongest opponents;
- confidence;
- avoid recommendation where appropriate.

### 4.15 Vault Performance and financial ledger

Provide a private, auditable Vault Performance area covering racing, tournaments, breeding activity, sales and BGC movements.

Full requirements are defined in `docs/VAULT_PERFORMANCE_LEDGER.md`.

#### Race-derived performance

Use owned-core race exports to derive, where available:

- entry fees spent;
- race payouts received;
- native-currency net result;
- normal open-racing performance;
- tournament qualification performance;
- automatic tournament-round payouts;
- grand-final race payouts;
- timeframe, tournament, bracket, mode, distance and core breakdowns.

Tournament and stage classification must be configurable and correctable because source labels may not be uniform.

#### Manual records

Allow the user to record activity absent from exports, including:

- overall tournament awards sent manually by the game owner directly to a crypto wallet;
- arena breeding fees earned;
- DNA and external arena fees paid for breeding;
- core sales and acquisitions;
- actual BGC received from burns;
- BGC used toward arena fees;
- supported adjustments.

A manual tournament award may be linked to one core, split across several cores, or retained at tournament/vault level.

#### Currency and BGC integrity

- Do not silently combine currencies or assets.
- Report native-currency totals first.
- Optional converted reporting totals require an explicit rate, source and effective date.
- BGC is a non-cash game credit and remains in a separate balance ledger.
- BGC received from burning is not cash/crypto profit by default.
- Arena listings are not income; a completed fee receipt must be recorded or imported.
- Asking prices or modelled core values are not realised profit.

#### Reconciliation and reporting

- Detect possible duplicates between manual entries and later export records.
- Require safe reconciliation rather than automatic deletion.
- Preserve provenance and adjustment history.
- Make every total drillable to source rows or manual ledger entries.
- Show data completeness, unclassified activity, missing cost basis and unconverted-currency warnings.

Primary reporting views:

- week, month, season, year, custom period and lifetime;
- by native currency/asset;
- open racing versus tournament activity;
- qualification versus rounds/finals versus manual awards;
- per core, mode, distance, tournament and bracket;
- arena fees earned;
- breeding fees paid and BGC used;
- core sales, acquisitions and burns;
- transaction ledger and reconciliation queue.

## 5. Data refresh workflow

Support periodic uploads or entries of:

- newer cumulative race-merge exports;
- updated core-details exports;
- current-vault exports;
- current arena exports;
- tournament calendars and manual rules;
- manual financial records and classification corrections.

The importer must:

- identify source type;
- validate schema;
- store import metadata;
- deduplicate cumulative history;
- preserve previous valid records;
- warn on conflicts;
- update analytical and financial aggregates;
- allow safe rollback of an import batch;
- never expose raw source files publicly.

Arena data is highly time-sensitive and listings commonly last 5 or 10 days. Display freshness prominently and do not treat old arena listings as active.

## 6. Explainability

Every recommendation must provide:

- recommendation category;
- key evidence;
- sample sizes;
- confidence;
- relevant uncertainty;
- strategic objective served;
- alternatives considered;
- reason not to select obvious alternatives where applicable.

Every Vault Performance total must provide source drill-down, currency/asset treatment, classification provenance and reconciliation/data-completeness status.

## 7. Non-goals for initial delivery

- automatic game login or race entry;
- scraping authenticated pages;
- public community product;
- guaranteed race or breeding outcomes;
- burn-credit prediction before an actual burn;
- remaining lifetime-race calculation;
- reliance on obsolete race class;
- deterministic claims about hidden breed qualities;
- tax return preparation or statutory accounting;
- automatic crypto-wallet monitoring;
- treating BGC, asking prices or modelled core values as cash profit.

## 8. Success measures

The product is successful when it can reliably:

- import refreshed data without duplication;
- reconstruct lineage and enforce breeding rules;
- identify mode-distance specialists using time evidence;
- prioritise worthwhile discovery races;
- preserve ME for the strongest mode-specific opportunity;
- configure varied tournament qualifications without code changes;
- recommend qualification candidates and race allocations;
- distinguish fastest-time specialists from median-time specialists;
- identify high-upside breeding pairs and vault-gap pairs separately;
- track open-racing, qualification, rounds/finals and manual tournament awards without double counting;
- keep BGC activity separate from cash/crypto profit;
- report vault performance by time, core, tournament and native asset with full drill-down; and
- provide auditable, backtested and uncertainty-aware recommendations.