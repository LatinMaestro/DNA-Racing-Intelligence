# API-First Data Contract

Status: **current source-data authority**  
Effective: **27 August 2026**

## 1. Source hierarchy

The preferred source is **DNA Open Lab v1 API**.

Normal path:

`DNA Open Lab API -> server-only typed client -> canonical adapters -> private R2 evidence/cache where useful -> owner-scoped Neon read models/aggregates -> private authenticated website`

CSV sources remain supported as:

- internal fallback;
- API-equivalence evidence;
- historical-gap evidence where the API does not expose an equivalent fact; and
- recovery/transition tooling until API completeness has been demonstrated.

Local owner strategy state is never replaced by API or CSV game data.

## 2. DNA Open Lab connection contract

Base URL:

`https://api.dnaracing.run/fbike/pub/v1`

Authentication:

- Bearer API key;
- server-side only;
- never sent to browser code;
- never committed to Git;
- never printed to CI/application logs, Issue comments or chat.

Expected scopes for the hosted website key:

- `vault`;
- `races`;
- `cores`;
- `tokens`; and
- `splice`.

Market data is future scope only after DNA implements/publishes it.

## 3. Response-envelope authority

The response body envelope is authoritative.

Every documented endpoint response must be parsed as one of:

- `status: success`; or
- `status: error`.

An HTTP success code does not override an error body. A documented error body returned with **HTTP 305** remains an API error and must be represented as such.

Malformed/missing envelopes fail closed and cannot publish canonical data.

## 4. Rate-limit contract

The application must work correctly at the minimum supported design tier of **30 requests/minute**.

Higher tiers of 80 or 150 requests/minute may shorten catch-up time but must not change correctness.

The client/scheduler must:

- capture available rate-limit response metadata;
- respect `Retry-After` on HTTP 429;
- avoid blind immediate retry loops;
- preserve durable progress before backing off; and
- expose enough metadata for sync/recovery observability without exposing secrets.

## 5. Documented request bounds

| Endpoint family/use | Maximum per request/window |
| --- | ---: |
| Vault info bulk | 100 |
| Core bulk families | 20 |
| Race docs/fills bulk | 20 |
| Finished races per time window | 200 |
| Vault search | 50 |

Request builders must reject out-of-bounds work before transport where practical. Fail-fast local validation must remain synchronous where that is the client contract.

## 6. Endpoint-family coverage

The typed server client and sync plan must cover documented read operations required from:

### Vault

- authentication/account scope proof;
- owned-Core/current-vault facts;
- search and bounded bulk info where required.

### Races

- active/current races;
- fill/current entrant state;
- finished races by bounded time window;
- race-document hydration; and
- recent/history evidence required for analytics and automatic post-race ingestion.

### Cores

- identity/basic Core data;
- documented bulk supplemental families;
- current power/adjusted-odds/variance where exposed;
- racing stats;
- stamina;
- equipped assets;
- owner/listing state; and
- current splice/lineage-related state where exposed.

### Tokens

- current/reference token prices or metadata exposed by the API.

Current token prices are reference/current context only. Historical economic valuation continues to use dated historical rates.

### Splice

- current Arena/listing state;
- `pair_info` official baby element/F/type/cost evidence;
- `pair_validate` official eligibility/viability evidence; and
- read-only request/status evidence where available after owner-manual splices.

No endpoint is used to initiate a splice, race, team, bet, wallet or market action.

## 7. Canonical-adapter contract

Provider transport names must not become analytics/UI vocabulary by accident.

Canonical adapters translate provider fields into stable domain records while retaining provenance.

Every canonical observation must retain, directly or by evidence reference where appropriate:

- source provider: `dna_open_lab`;
- API version: `v1`;
- endpoint family;
- authoritative source/entity ID(s);
- stable canonical entity/natural key;
- source timestamp when provided;
- retrieval timestamp;
- deterministic checksum of canonicalized raw JSON evidence;
- optional/private evidence-object reference; and
- canonical validation status.

Provider-specific names such as `hid`, `rvmode`, `cb` and future transport aliases stay inside the provider boundary.

## 8. Optional and additive fields

The API is allowed to add optional fields without breaking the client.

Rules:

- preserve additive fields in raw evidence/checksum provenance where possible;
- do not silently promote a new field into analytical meaning;
- continue parsing known required/current fields;
- accept documented nullable/optional states;
- fail closed where an existing required field becomes invalid or structurally incompatible; and
- add a versioned canonical mapping only after meaning is established.

## 9. Historical race backfill completeness

`/races/finished` is bounded to 200 results per time window.

A 200-result response is treated as **potentially saturated**, not complete.

The crawler must recursively split time windows until each accepted leaf window is demonstrably below saturation or another documented completeness proof exists. Full race documents are then hydrated in batches of at most 20.

The crawler retains durable window/checkpoint state so restart and access loss do not restart history blindly.

## 10. Idempotency and last-good publication

Every sync/backfill family must support replay.

- stable natural keys prevent duplicate facts;
- the same accepted evidence may be replayed without duplicating state;
- partial refreshes do not replace last-good publication;
- checkpoint advancement is durable and bounded;
- a failed downstream write cannot advance publication incorrectly; and
- catch-up resumes from the last successful cursor/window/checkpoint.

## 11. API access loss and stale-but-usable behavior

If the key/tier/API becomes unavailable:

- background sync pauses;
- the last successfully synced dataset remains active;
- analytics and owner workflows continue using retained local read models;
- affected current-state views show freshness/stale status; and
- catch-up resumes when access returns.

The application must not fail simply because current API access is unavailable.

## 12. Current observations versus historical evidence

Current API facts may include power, adjusted odds, variance, stamina, equipped assets, owner/listing state, current racing stats and splice state.

These are **timestamped current observations**. They are not automatically historical features.

Historical backtests/recommendations may use a current-style field only if an observation of that field existed before the historical event cutoff. Otherwise it is excluded to prevent leakage.

Historical race time/speed/exact-distance evidence, Gold/Blue star evidence, payout-format context and accepted economic facts retain their existing chronological rules.

## 13. Race-performance fidelity

Canonical historical race evidence must preserve enough information to support existing analytics, including where available:

- event/race ID;
- Core ID;
- mode;
- exact distance;
- gate count;
- event/start timestamp;
- elapsed time/finishing position;
- Gold/Blue source evidence;
- fee/prize/token;
- payout mechanism/format;
- restrictions/tags;
- current-through/source provenance; and
- deterministic identity/fingerprint.

Lower elapsed time and higher speed remain primary performance evidence by exact mode/distance. Gold/Blue and finish/payout context remain supporting evidence under `GAME_RULES.md`, `STAR_SIGNAL_SPECIFICATION.md` and `ANALYTICS_METHOD.md`.

## 14. Ownership authority

Current DNA-owned Core state should be reconciled from the API once connected evidence proves the exact ownership contract.

API ownership may update game-holding facts but must not erase local state including:

- owner notes;
- manually maintained/strategic Maiden state;
- Pro League roster versions;
- annual substitution ledger;
- Discovery plans;
- lifecycle state;
- manual accounting/reconciliation; or
- Tournament configuration.

Ownership history remains auditable.

## 15. Pro League data requirements

The Pro League domain requires enough current and historical evidence to validate and explain:

- roster membership and name;
- class/element/F-number/sex;
- current ownership;
- exact-distance/mode historical strength;
- sample counts and recency;
- star/payout-format evidence;
- current API dimensions kept separate from historical evidence;
- structural gaps;
- alternates;
- substitution usage/history;
- Discovery opportunities; and
- breeding opportunity/pair validation evidence.

No API response may automatically create a roster substitution or overwrite owner strategy history.

## 16. Splice and breeding data authority

Where the API exposes official values:

- `pair_info` is the authority for the current official baby element/F/type/cost preview returned for that pair/request context;
- `pair_validate` is the authority for current official pair eligibility/validation returned for that pair/request context.

Historical lineage/performance analysis remains this application's strategic evidence. Official viability/cost does not by itself imply a high-quality racing outcome.

The website never performs a splice transaction.

## 17. Token/economic separation

API token prices are used only for current/reference displays unless a separate dated source contract explicitly supports historical valuation.

Historical fees/payouts preserve original asset amounts and use the existing dated-valuation rules. A current listing price is a listing fact, not realised income, fair value or cost basis.

BGC remains a separate non-cash game credit under the existing economic rules.

## 18. R2 evidence contract

Private R2 may retain:

- raw/full API payload evidence where useful;
- manifests/checksums;
- bounded cache objects;
- replay artifacts;
- retained CSV raw/fallback evidence; and
- large analytical objects not suited to Neon.

Requirements:

- private bucket only;
- no public `r2.dev` access;
- opaque/owner-scoped keys;
- checksum verification;
- no raw API payloads in Git/CI artifacts; and
- bounded cleanup/recovery rules.

## 19. Neon contract

Neon should contain only compact state that benefits from relational transactions/RLS, including:

- owner mapping;
- sync/checkpoint/publication state;
- current canonical read models;
- compact historical analytical aggregates;
- Pro League local state;
- Tournament/Maiden state;
- economics/reconciliation; and
- recovery/operation metadata.

Persistent API schema/migrations must follow connected P3 payload evidence rather than guessed wire shapes.

## 20. CSV fallback contract

The existing importer remains supported but secondary.

Known fallback families include historical Race Merge, Core Details and Arena evidence plus prior owner-maintained/retired vault evidence where retained for reconciliation.

CSV behavior remains:

- immutable private raw evidence;
- deterministic schema/version detection;
- provenance/checksum retention;
- idempotent replay;
- conflict quarantine;
- rollback/recovery; and
- API-vs-CSV equivalence comparison.

Spreadsheet-specific optimisation is not part of the critical path unless a demonstrated API gap requires it.

## 21. Source-authority matrix

P3 must produce and maintain a table with one row per canonical fact family:

| Canonical fact | API authority | CSV fallback | Local state | Notes/equivalence status |
| --- | --- | --- | --- | --- |
| Current ownership | to prove in P3 | historical/reference | local strategy separate | do not overwrite local notes/strategy |
| Historical race facts | to prove in P3 | Race Merge | none | compare IDs/times/positions/mode/distance/gates/stars/economics/tags |
| Core identity/lineage | to prove in P3 | Core Details | none | preserve durable IDs |
| Current Arena/splice | to prove in P3 | Current Arena | shortlist/local decisions | official pair info/validation when available |
| Current token price | API current/reference | none | none | not historical valuation |
| Pro League roster | none | none | authoritative local state | owner-managed/advisory |

No API-vs-CSV source is declared superseding until representative equivalence and field authority are proven.

## 22. Privacy and secret safety

- real API payloads, CSVs, database dumps and owner-specific exports stay outside Git;
- deterministic synthetic fixtures are used in tests;
- secrets are server-side only;
- logs use stable issue codes/metadata rather than full raw records;
- private R2/Neon remain owner-scoped;
- never request/store private keys, seed phrases or signing credentials; and
- never expose a game/API credential to client-side JavaScript.

## 23. Licensing/attribution

DNA Open Lab API use is currently authorised only for non-commercial use under the owner's stated scope. Do not introduce commercial use without explicit approval. API-backed website surfaces must attribute DNA Racing.

## 24. Historical spreadsheet-first evidence

Before 27 August 2026, CSV imports were the primary data path. That detailed contract remains preserved in Git history and specialised phase documents and continues to inform fallback, recovery, RLS, evidence retention, race economics and equivalence testing.

Where those historical documents describe CSV as the normal source or periodic snapshot as the only source of current state, this API-first contract supersedes that statement.
