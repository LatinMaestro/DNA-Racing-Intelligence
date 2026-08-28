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
model for API-authoritative owned-Core identity. Migration `0072` adds
generation-bound active-race/fill persistence with complete family receipts,
deterministic race identity, point-in-time chronology, owner RLS, last-good
serving and active/fill referential coverage. Migration `0073` persists all
seven supplemental current-Core families with exact owned-Core coverage, owner
RLS and last-good reads. Token prices and complete paginated Splice Arena now
have generation-bound canonical materialization. Migration `0074` adds compact
owner-RLS Token, Arena mode/page-receipt and listing persistence with complete
pagination publication guards and last-good reads. The Neon publication
adapter now validates owned Cores, races/fills, all seven supplemental Core
families, Token prices and complete Arena pagination before one `0074` staging
transaction; retired partial-stage privileges fail closed. Acquisition-worker
scheduling now has a deterministic local cadence and recovery policy with
30-request batches, complete cached-or-refreshed evidence guards and on-demand
pair reads. A one-request bounded runner dispatches through the conservative
client pool, requires idempotently persisted evidence receipts and advances an
exact-schedule compare-and-swap checkpoint after every accepted request. The
compact migration `0075` and its Neon adapter now enforce owner-RLS,
function-only access, append-only progress, idempotent replay, immutable cycle
authority and serializable compare-and-swap updates. The private R2 current-state
evidence sink now writes one immutable object per cycle/request, verifies bucket
privacy and exact object metadata, and returns the first durable receipt on a
crash replay. Dynamic plan assembly now derives sorted owned-Core and
active-race identities from validated bootstrap evidence, requests exactly the
next contiguous Arena page for each non-terminal mode and withholds the
immutable runner plan until every requested mode proves a terminal page.
Duplicate identities, page gaps, response/request drift, changing limits and
schedules beyond the 512-request durable-cycle capacity fail closed. The
private evidence reader now verifies receipt-bound object identity, metadata,
bytes and JSON before replay. Deterministic child cycles execute the minimal
bootstrap and each bounded Arena continuation through the existing
compare-and-swap runner and immutable R2 sink, then return the final immutable
plan without publishing it. Wiring that final plan through materialization and
the atomic `0074` publication repository remains incomplete.

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

- current competition mode is **Bike only**; exclude Car and Horse evidence from Pro League ranking, Discovery and mapping;
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

Deliver roster versions, nucleus/optional slots/alternates, reason/evidence snapshots and annual substitution ledger. Also version the four published 42-race maps, model the 50/50 two-Vault gate allocation and home-Vault map control, implement single-race versus same-type-and-distance assignment scopes, validate mapped Cores against the roster and expose total/first-16 mapping coverage. Map 5 remains unavailable until published. API ownership reconciles game holdings but never erases local notes, ME, roster, substitution, mapping or lifecycle strategy state.

Add an opposition selector and matchup planner. Compare our eligible rostered
Cores with the opposing Vault at the exact Bike race type and distance; rank
maps when we are home and provide a defensive view when away. Unknown opponent
evidence stays unknown. Enumerate weak/unproven format-distance demands and
route them to bounded Discovery or breeding. Never recommend roster lock merely
because a Core is the best weak option currently owned; if structural rules
force temporary inclusion, label it provisional and preserve the annual
10-substitution budget for evidence-backed replacements.

Candidate ordering must be performance-led, not win-rate-led. Establish the
same Bike race-type-plus-exact-distance population boundary, then compare
elapsed-time central tendency and consistency, valid derived speed,
sample/freshness and benchmark band. Keep wins/Top-3s, payout format, stars and
strong-opposition results as separately disclosed supporting evidence. Missing
field-quality evidence is unknown, never favourable.

Exit: synthetic rule-valid Pro League roster and map-lineup workflow.

## P7 — Pro League intelligence enrichment

Keep audited historical Bike Core Performance, exact-distance, star,
payout/sample and recency evidence as the primary historical base. Car and Horse
remain separate non-Pro-League evidence and must not affect this workflow.

Materialize the joint race-type-plus-exact-distance benchmark/read contract
needed by the published maps. If the API still lacks authoritative elapsed time,
distance or result fields, show that historical dimension as unavailable rather
than fabricating it or reviving CSV as a delivery dependency.

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
- commission `/pro-league` with nucleus/current roster/alternates, compliance, roster-size rationale, opposition analysis, home-map ranking/away defensive preparation, equal gate allocation, head-to-head exact-format mappings, published map definitions, staged race-line mappings/coverage, evidence dimensions, substitution budget/history, weak best-available warnings, Discovery queue, active-race opportunities, breeding queue, official pair viability/cost, structural gaps/marginal slots and sync/freshness/stale-but-usable status;
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
