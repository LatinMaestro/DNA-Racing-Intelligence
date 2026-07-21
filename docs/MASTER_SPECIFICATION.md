# DNA Racing Intelligence — Master Product Specification

## 1. Product purpose

DNA Racing Intelligence is a private, single-user analytics and decision-support website for improving the owner’s DNA Racing vault.

It must convert historical race results, core metadata, current vault holdings, current arena listings, user-entered tournament parameters and recorded economic activity into practical recommendations and auditable reporting. The system is advisory. It does not connect to the game, enter races, purchase splices, sell cores, burn cores or initiate wallet transactions.

The product objective is balanced across:

- tournament success;
- DEZ or other financial performance where relevant;
- discovery of elite racers;
- long-term vault quality;
- breeding quality and rare exceptional-offspring potential;
- coverage across modes, distances, elements, breeds and leaderboard groups; and
- disciplined retention, sale and burn decisions.

No single objective permanently overrides the others. Recommendations must show the trade-off where objectives conflict. Economic reporting must not overstate incomplete source coverage as complete lifetime profit.

## 2. Users, access and privacy

- One user: the repository owner.
- Authentication is required.
- No public pages, public profiles, public recommendations or public API.
- Disable search indexing.
- Keep source exports, processed data, economic records and models private.
- Do not commit real exports or database snapshots to GitHub.
- Build and operate online through GitHub, Codex, Vercel and managed data services.
- The user should not need to run the application locally.
- Never request or store crypto private keys, seed phrases or signing credentials.
- The application may record wallet/account labels and transaction references but must not initiate blockchain or game transactions.

## 3. Source datasets

The initial supplied exports include:

- cumulative or sequential race-merge CSV exports;
- core-details CSV export;
- current-vault CSV export;
- current-arena/splicing CSV export;
- season/tournament calendars and rule screenshots; and
- user-entered economic transactions, manual tournament payouts and reconciliation records.

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
- selected Vault Performance indicators; and
- data freshness, reconciliation and import warnings.

### 4.2 Vault registration and ownership lock

Allow the user to establish and maintain the active vault using core ID and name.

Requirements:

- import current-vault CSV;
- manually add or remove owned cores;
- manually confirm or override ME status;
- link owned IDs to core details, race results and family tree;
- retain historical ownership/import provenance;
- assume owned active cores are available for breeding unless marked unavailable;
- do not include burnt cores in active-vault recommendations;
- preserve burnt cores in historical lineage analysis.

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
- lifecycle recommendation; and
- economic activity and realised result where supportable.

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
- notes and source evidence.

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

An arena listing is not evidence that the listed core was used or that its owner earned a fee.

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
- Do not predict burn-credit value.
- Prioritise overall vault quality, not burn-credit return.
- Protect unresolved ME, specialist, discovery, lineage and breeding value.
- Allow the actual BGC credit received after a burn to be entered in Vault Performance.

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

### 4.15 Vault Performance and accounting

The website must include a private, auditable Vault Performance area. The complete requirements in `docs/VAULT_PERFORMANCE_ACCOUNTING.md` form part of this master specification.

It must track:

- normal open-race entry fees, payouts and net result;
- tournament qualification entry fees, race payouts and net result;
- automated tournament round and final payouts;
- manually recorded tournament prizes paid directly by the game owner to a crypto wallet;
- breeding fees earned from completed external use of owned cores;
- DNA base and external arena fees paid;
- BGC spent on arena fees;
- core purchase costs, sale proceeds and cost basis where known;
- permanent burns and actual BGC credits received;
- deposits, withdrawals, transfers, opening balances and reconciliation adjustments; and
- reporting by timeframe, tournament, core, mode, distance, category and asset/currency.

Accounting controls:

- keep unlike currencies/assets separate unless an explicit dated conversion is supplied;
- treat BGC as a separate non-cash in-game credit by default;
- do not infer breeding income from arena listings;
- do not infer complete wallet balances from race activity alone;
- exclude deposits, withdrawals and internal transfers from operating P/L;
- do not value unsold cores in realised P/L by default;
- do not fabricate core-sale profit where acquisition cost is missing;
- derive race fees and payouts idempotently from validated source fields;
- support manual entries, corrections, reversals, duplicate warnings and reconciliation;
- show source coverage and complete/partial/estimated status;
- never request or store wallet private keys, seed phrases or signing credentials.

Required views include:

- Vault Performance dashboard;
- tournament campaign economics;
- core economic profile;
- separate BGC movement and balance where supportable;
- manual transaction and payout entry;
- classification/reconciliation queue;
- detailed ledger and filters.

## 5. Data refresh workflow

Support periodic uploads of:

- newer cumulative race-merge exports;
- updated core-details exports;
- current-vault exports;
- current arena exports;
- tournament calendars and manual rules;
- manual economic transactions and external tournament payouts; and
- future authoritative economic exports where supported.

The importer must:

- identify source type;
- validate schema;
- store import metadata;
- deduplicate cumulative history;
- derive race economic entries without duplication;
- preserve previous valid records;
- warn on conflicts;
- update aggregates;
- allow safe rollback of an import batch;
- never expose raw source files publicly.

Arena data is highly time-sensitive and listings commonly last 5 or 10 days. Display freshness prominently and do not treat old arena listings as active or as completed breeding transactions.

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

Every economic report must provide:

- date and source coverage;
- included assets/currencies;
- classification and reconciliation status;
- missing acquisition costs or opening balances;
- conversion use;
- unclassified transaction count; and
- complete, partial or estimated status.

## 7. Non-goals for initial delivery

- automatic game login or race entry;
- scraping authenticated pages;
- public community product;
- guaranteed race or breeding outcomes;
- burn-credit prediction;
- remaining lifetime-race calculation;
- reliance on obsolete race class;
- deterministic claims about hidden breed qualities;
- initiation of crypto or wallet transactions;
- storage of private keys or seed phrases;
- automatic cash valuation of BGC;
- realised P/L that includes unsold-core estimates; and
- claims of complete lifetime profit from incomplete source coverage.

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
- derive race fees and payouts without double counting;
- reconcile qualification, automated-stage and manual tournament payouts;
- report open racing, tournament, breeding, core trading and BGC activity without combining incompatible assets;
- disclose incomplete financial coverage and missing cost basis; and
- provide auditable, backtested and uncertainty-aware recommendations and reporting.