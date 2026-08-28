# Build Plan

Status: **current delivery authority**  
Effective: **27 August 2026**

## Delivery objective

Deliver the earliest safe **private owner-usable Pro League** experience first, then continue directly to complete private website commissioning.

Work in dependency order with one dependency-critical pull request active at a time. Every merge requires exact-head canonical validation, complete diff/review/thread review and verification of resulting `main` before the next dependent slice starts.

DNA Open Lab v1 is the sole game-data source on the delivery critical path. Existing CSV ingestion/equivalence code is preserved but benched as an optional future integration. CSV proof cannot block API persistence, Pro League commissioning or private website commissioning.

## Target architecture

`DNA Open Lab API -> server-only client/sync planner -> private R2 raw/cache/evidence where useful -> canonical source adapters -> compact owner-scoped Neon read models/aggregates -> private authenticated website`

The browser never calls DNA Open Lab directly and never receives the Bearer key.

## P0 — Authority reconciliation

Deliver:

- complete the initial DNA Open Lab v1 client contract;
- reconcile `README`, `BUILD_PLAN`, `ARCHITECTURE`, `DATA_CONTRACT`, `DATA_UPDATE_WORKFLOW`, `ESPORTS_PRO_LEAGUE_PREPARATION`, `GAME_RULES` and `DECISION_LOG` to one current API-first authority;
- retain spreadsheet-first design and prior Pro League rules only as labelled historical evidence/fallback context; and
- remove current-rule ambiguity where the owner has supplied newer authority.

Exit: one authoritative current architecture/rule set.

## P1 — Keyless API contract, fixtures and canonical adapters

Deliver:

- complete typed server client coverage for documented `vault`, `races`, `cores`, `tokens` and `splice` endpoints;
- strict `status: success|error` body-envelope handling, including authoritative error bodies returned with HTTP 305;
- rate-limit metadata, `Retry-After` handling and explicit 429/backoff behavior;
- documented request bounds: vault info 100, core bulk 20, race docs/fills 20, finished-race window 200 and vault search 50;
- optional additive-field tolerance without silently accepting invalid required fields;
- secret-safe transport behavior and server-only Bearer use;
- deterministic synthetic fixtures/mock transport for success, error, empty, null, additive-field and boundary cases; and
- canonical API-neutral adapters so DNA transport names such as `hid`, `rvmode` and `cb` do not leak into analytics/UI.

Canonical provenance must retain stable source/entity identifiers, source/retrieval timestamps, endpoint/version, deterministic raw checksum and enough evidence to replay/compare.

Exit: complete credential-free API boundary.

## P2 — Keyless Tier-1-safe sync/backfill architecture

Assume the minimum supported tier of **30 requests/minute**. Higher 80/150 request tiers may improve speed but must not be required for correctness.

Deliver:

- bulk-first scheduler with rate-budget accounting;
- adaptive `/races/finished` crawler that recursively splits any saturated 200-result time window until completeness is demonstrable;
- race-document hydration in batches of at most 20;
- vault ownership, Core supplemental families, active races/fills, Splice Arena/pairs and token sync plans;
- durable cursors/checkpoints, idempotency, retries/backoff and catch-up semantics;
- last-good publication so an incomplete refresh cannot replace a valid dataset;
- private R2 API-evidence writer/manifests where useful;
- preserve the existing API-vs-CSV equivalence harness without extending it on the critical path; and
- outage/tier-loss behavior where sync pauses but the website remains usable from retained data.

Exit: all safe foundations are ready before a live key is required.

## K1 — API key provisioning point

Reach K1 after P1/P2 are complete.

Configure one private hosted website key with `vault+races+cores+tokens+splice` scopes. The raw key must never be pasted into chat, Git, CI logs, Issue comments or browser-visible configuration.

K1 authorises **read-only connected contract/capability testing only**. It does not authorise persistent real API backfill.

If the key is unavailable at K1, continue all remaining keyless work and mocked UI/read-model work. Pause only when the next dependency truly requires live payload evidence.

## P3 — Connected read-only discovery and source authority

After the key is privately configured, prove:

- `test_auth`, scopes, rate headers and real error behavior;
- representative vault/core/tier/recent-race shapes;
- all Core bulk families;
- active races, fills, finished windows and full race documents;
- tokens;
- Splice Arena, `pair_info` and `pair_validate`;
- real optional/null/nested behavior, identifiers, timestamps, natural keys and history depth; and
- an explicit capability matrix that marks any unexposed API fact as unavailable/limited.

Produce a source-authority matrix classifying each fact as:

- API authority;
- API unavailable/limited; or
- local strategic state.

Never commit real payloads. Private evidence belongs in approved private storage.

Exit: persistence and UI design can safely follow real payloads rather than guesses. CSV equivalence is not required. A valid `pair_validate` success is a P9 dependency, not a blocker for P4/P6.

## P4 — API-first persistence, R2 and incremental sync

Deliver migrations/read models only from P3 evidence.

- keep compact Neon sync checkpoints/current state;
- place raw/full evidence in private R2 where useful;
- reuse existing historical analytical read models rather than duplicating them;
- ingest historical races through bounded API windows/batches rather than whole-sheet Neon staging;
- refresh current Core/Vault/Splice/Tokens with endpoint-appropriate cadence;
- separate current observations from historical backtest facts so today's power/stamina/assets/listing/game stats cannot leak into past recommendations;
- publish only complete last-good refreshes; and
- leave the benched CSV importer unchanged.

Current implementation state: migrations `0069` and `0070` provide atomic
last-good generation publication plus durable finished-race/R2 receipt
checkpoints. Migration `0071` adds the first generation-bound current read
model for API-authoritative owned-Core identity. Supplemental current Core,
active-race, fill, Token and Splice Arena materialization plus scheduling remain
incomplete.

Exit: synthetic/replayable API sync can reconstruct canonical site data without spreadsheet upload.

## P5 — Storage, capacity, recovery and first persistent real-sync gate

Deliver evidence for:

- PostgreSQL 18 physical storage and peak behavior for API paging/batching, including heap/index/TOAST/transient overlap;
- private R2 footprint and cost projection;
- restart/replay/idempotency;
- partial failure and rate-limit recovery;
- API/tier loss and reinstatement catch-up;
- stale-but-usable cached website operation; and
- explicit positive headroom below **536,870,912 bytes** before persistent real API backfill.

Present the exact cost/recovery/capacity evidence and **STOP for explicit owner approval** before the first persistent real Preview sync.

Exit: technically safe API data path ready for owner-approved real Preview persistence.

## P6 — Current Pro League domain, validator and persistence

Implement the current roster authority:

- My Vault remains unlimited;
- legal roster size is **12–25**;
- quality-first nucleus; never force 25;
- maximum 10 substitutions per year;
- initial-roster substitution counting remains explicit/configurable until DNA clarifies;
- maximum 7 Metal, 8 Fire and 10 Earth;
- maximum 2 Genesis per element;
- maximum 5 Cores at F5 or below;
- maximum 12 Cores at F10 or below;
- minimum 2 Cores above F15;
- minimum 8 females; and
- every rostered Core has a name.

Deliver roster versions, nucleus/optional slots/alternates, reason/evidence snapshots and annual substitution ledger. Also version the four published 42-race maps, implement single-race versus same-type-and-distance assignment scopes, validate mapped Cores against the roster and expose total/first-16 mapping coverage. Map 5 remains unavailable until published. API ownership reconciles game holdings but never erases local notes, ME, roster, substitution, mapping or lifecycle strategy state.

Exit: synthetic rule-valid Pro League roster and map-lineup workflow.

## P7 — Pro League intelligence enrichment

Keep audited historical Core Performance, exact-distance, star, payout/sample/recency and cross-mode evidence as the primary historical base.

Add separately presented current API dimensions where available:

- power;
- adjusted odds/variance;
- game racing stats;
- stamina;
- equipped assets;
- owner/listing state; and
- current splicing/lineage state.

Do not blend these blindly into one opaque score. Timestamp current observations, prevent historical leakage and statistically evaluate predictive lift before adding ranking weight.

Exit: transparent current-rule roster advice identifying strongest nucleus, marginal slots, structural gaps, uncertain candidates and Discovery gaps.

## P8 — Pro League targeted Discovery acceleration

Convert roster uncertainty into ranked experiments:

- prioritise tests capable of changing roster membership or replacing marginal slots;
- retain the ten-race exact-distance minimum for minimally analytical conclusions;
- use lineage/adjacent-distance hypotheses and stop weak paths early;
- use active race/fill API data to surface suitable manual racing opportunities without entering races; and
- ingest finished results automatically after sync and update readiness.

Exit: daily owner Discovery queue for Pro League.

## P9 — Pro League breeding acceleration

Derive breeding objectives from roster structural/performance gaps without suppressing exceptional upside.

Use:

- current Splice Arena;
- official `pair_info` baby element/F/type/cost;
- official `pair_validate` eligibility;
- historical lineage/performance/upside research; and
- pair shortlist/offspring tracking after later sync.

No splice or wallet transaction is permitted.

Exit: official-validation-backed breeding queue.

## P10 — Private Pro League Preview commissioning

After owner-approved persistent API sync:

- backfill sufficient historical API evidence plus current Vault/Core/Splice state;
- verify API counts/coverage, aggregates, freshness, disclosed capability limits, no leakage, RLS, recovery and secret safety;
- commission `/pro-league` with nucleus/current roster/alternates, compliance, roster-size rationale, published map definitions, staged race-line mappings/coverage, evidence dimensions, substitution budget/history, Discovery queue, active-race opportunities, breeding queue, official pair viability/cost, structural gaps/marginal slots and sync/freshness/stale-but-usable status;
- integrate only the My Vault/Core Intelligence/Discovery/Breeding flows required for daily Pro League use;
- allow one deliberate protected private Vercel Preview deployment at this major milestone if required; automatic Git deployment remains disabled; and
- perform owner acceptance and immediately correct commissioning blockers.

Milestone: **PRO LEAGUE COMMISSIONED FOR PRIVATE OWNER USE**.

# Full private website after P10

## F1 — API-native My Vault and Core Intelligence

Ownership reconciliation plus rich current Core profile: power/adjusted odds/variance/stamina/assets/listing/owner/racing stats/recent races/splicing together with historical analytics, with explicit current-vs-historical separation.

## F2 — API-native Open Race Intelligence

Active-race browser, restrictions/status/times/fees/token, fill ticker/current entrants, automatic owned-Core field analysis and alternatives/avoid guidance. Retain manual fallback. Never enter a race.

## F3 — Full Breeding/Splice

Current Arena, official pair info/validation/costs, lineage/upside rankings, cycle/lifetime counts, read-only request-ID tracking after owner-manual splice and offspring/cost-basis reconciliation.

## F4 — Tournament and Maiden completion

Finish the canonical Tournament editor/persistence/candidate/campaign work. Use API race freshness/classification where useful. API `is_maiden` is observed game state; local strategic/ME state remains separate and auditable.

## F5 — Vault Performance/economics

Complete asset-separated ledger, reconciliation and reporting. API token prices are current/reference displays only. Historical dated valuation remains authoritative. Listing price is a listing fact, not automatic fair value or income. Keep only a future Market adapter placeholder until DNA publishes that scope.

## F6 — Lifecycle adviser enrichment

Race/discover/Maiden/breed/hold/sell/burn guidance with separated current API context, Genesis burn exclusion and no game/market actions.

## F7 — Unified Dashboard, readiness and API operations

Show last sync by family, current-through/stale/backfill state, recent races, active opportunities, Discovery, Pro League, breeding, Tournament/Maiden and economics, with simple sync-paused/tier state and recovery/catch-up observability.

## F8 — Whole-product validation and hardening

Prove chronological/no-leakage behavior, calibration, additive-schema/error/rate/outage/tier handling, backfill completeness, R2/Neon backup/recovery/idempotency/RLS/auth/key secrecy, accessibility/mobile/performance, economics, disclosed API limitations, DNA attribution and non-commercial policy.

## F9 — Full private website commissioning and handover

Freeze the exact candidate, run connected Preview acceptance for every workflow, present final provider/storage/cost/security/recovery evidence and **STOP for explicit owner Production approval**. Only after approval may controlled private Production deployment/migrations/API secret and real sync verification occur. Keep CSV integration in the optional backlog unless the owner separately reactivates it. Complete operator docs and Definition of Done.

## Optional backlog — CSV integration

After the API-only private website is commissioned, the owner may separately approve CSV upload, historical-gap ingestion or API-vs-CSV comparison. Until then:

- do not request CSV files;
- do not extend spreadsheet-specific code;
- preserve existing implementation and synthetic tests; and
- expose API data gaps honestly rather than using CSV implicitly.

## Safety and approval boundaries

- No Production deployment, schema or real-data change without explicit owner approval.
- No persistent real API backfill before the P5 owner gate.
- No public routes/domains, paid capacity, commercial API use or wallet/game/team/race/betting/splice transaction.
- Bounded reversible synthetic/private Preview operations are allowed when configured; clean all residue.
- Vercel automatic Git deployments remain disabled. Deliberate protected Preview deployment is reserved for major milestones such as P10 unless development genuinely requires it.
- API access loss pauses sync only; it must not make the website unusable.
- Exact-head validation includes dependency audit, secret scan, Prettier, ESLint, strict TypeScript, complete tests/build, Worker bindings/dry-run and relevant migration apply/smoke/reverse/removal plus connected acceptance when the slice changes a hosted boundary.
