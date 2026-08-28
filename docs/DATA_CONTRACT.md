# API-First Data Contract

Status: **current source-data authority**  
Effective: **27 August 2026**

## 1. Source hierarchy

The sole game-data source on the current delivery critical path is **DNA Open Lab v1 API**.

Normal path:

`DNA Open Lab API -> server-only typed client -> canonical adapters -> private R2 evidence/cache where useful -> owner-scoped Neon read models/aggregates -> private authenticated website`

Existing CSV code and historical evidence are preserved but benched. CSV ingestion, upload and API-equivalence work are optional future integrations and are not commissioning prerequisites.

If the API does not expose a fact, canonical state records that capability as unavailable/limited. The product must not fabricate the fact or silently substitute CSV on the critical path.

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

The website uses one fixed **30 requests/minute combined cap across all configured keys**. Higher advertised limits, including the observed 150 requests/minute per key, are metadata only and must not automatically raise either a lane or aggregate allowance. Any future increase requires a separate owner decision and focused configuration change.

The client/scheduler must:

- capture available rate-limit response metadata;
- cap default lane and aggregate execution at 30 requests/minute;
- respect `Retry-After` on HTTP 429;
- avoid blind immediate retry loops;
- preserve durable progress before backing off; and
- expose enough metadata for sync/recovery observability without exposing secrets.

## 5. Documented request bounds

| Endpoint family/use            | Maximum per request/window |
| ------------------------------ | -------------------------: |
| Vault info bulk                |                        100 |
| Core bulk families             |                         20 |
| Race docs/fills bulk           |                         20 |
| Finished races per time window |                        200 |
| Vault search                   |                         50 |

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

Connected evidence currently supports race metadata, entrants, fees, tags and scheduling fields. It does not yet expose direct elapsed-time, finishing-position or explicit distance fields. `track` remains a source value and must not be treated as canonical distance without authority. Race Merge therefore remains the fallback authority for historical outcomes/performance.

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

The v1 canonical boundary preserves undocumented nested Core values as
JSON-safe source values with endpoint, entity, observation-time and evidence
provenance. It does not interpret provider power, adjusted odds or variance as
elapsed-time performance; infer an unlisted state from omitted listing fields;
or derive ranking inputs from current racing-stat summaries. Only documented
structural fields are normalized, and every predictive use requires a separate
meaning, chronology and lift decision.

Supplemental Core publication is all-or-nothing across racing stats, power,
listing, attached assets, owner, stamina and splicing. Each family must cover
the exact complete owned-Core set for the same generation; a partial family
cannot advance the serving generation.

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
- joint Bike race-type-plus-exact-distance elapsed-time, valid derived-speed and
  consistency evidence with population benchmark counts and thresholds;
- sample counts and recency;
- descriptive win/Top-3, star, payout-format and independently established
  strong-opposition evidence kept separate from intrinsic performance;
- current API dimensions kept separate from historical evidence;
- structural gaps;
- alternates;
- substitution usage/history;
- Discovery opportunities; and
- breeding opportunity/pair validation evidence.

The published Pro League map catalogue and the owner's staged mappings are not
DNA Open Lab race-history facts. Keep them in the local strategic/configuration
boundary:

- version the four observed 42-race map definitions and their public source;
- keep the fifth planned map unavailable until published;
- retain exact map, race number, type and distance for every line;
- expand `same_type_and_distance` only within the selected map;
- require mapped Cores to belong to the selected roster; and
- keep match-map choice and every DNA Esports submission manual.

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
- dormant retained CSV evidence, if already present; and
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

## 20. Optional CSV integration boundary

The existing importer remains preserved but inactive for current delivery.

No new CSV file is required from the owner. New upload, equivalence, spreadsheet optimisation and CSV persistence work is deferred to an optional post-critical-path backlog.

If CSV integration is explicitly resumed later, its existing safety behavior remains:

- immutable private raw evidence;
- deterministic schema/version detection;
- provenance/checksum retention;
- idempotent replay;
- conflict quarantine;
- rollback/recovery; and
- separately approved comparison or reconciliation.

An API gap is disclosed as a product limitation; it does not automatically reactivate CSV work.

## 21. Source-authority matrix

Connected discovery maintains one row per canonical fact family:

| Canonical fact                 | Critical-path class   | Local state               | Connected status                                                                  |
| ------------------------------ | --------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| Current ownership              | API authority         | local strategy separate   | Vault/Core ownership shapes proven                                                |
| Historical race metadata       | API authority         | none                      | shapes and bounded two-to-three-year availability proven                          |
| Historical race outcomes       | API unavailable       | none                      | no direct elapsed/position/explicit-distance fields observed; disclose limitation |
| Core identity/lineage          | API authority         | none                      | identity and splicing shapes proven                                               |
| Current Arena/splice           | API authority         | shortlist/local decisions | Arena and pair-info shapes proven; valid-pair success remains a P9 concern        |
| Current Core operational state | API authority         | none                      | timestamped power/stamina/assets/listing/stats observations                       |
| Current token price            | API authority         | none                      | current/reference only; never historical valuation                                |
| Historical dated valuation     | API unavailable       | owner evidence separate   | current token endpoint cannot reconstruct historical valuation                    |
| Pro League roster/strategy     | local strategic state | authoritative local state | API ownership must not overwrite roster, notes or strategy                        |

API persistence may proceed from proven connected contracts without representative CSV equivalence. The redacted connected observations and known limitations are recorded in `DNA_OPEN_LAB_CONNECTED_DISCOVERY.md`.

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

Before 27 August 2026, CSV imports were the primary data path. That detailed contract remains preserved in Git history and specialised phase documents as historical engineering evidence and an optional future integration.

Where those historical documents describe CSV as the normal source or periodic snapshot as the only source of current state, this API-first contract supersedes that statement.
