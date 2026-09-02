# Decision Log

Status: **current decision authority**  
Reconciled: **27 August 2026**

## Historical record preservation

This file is a current decision log, not a deletion of prior evidence.

The complete pre-API decision chronology that existed immediately before this reconciliation is preserved immutably in Git at commit:

`27d75464e5ffb4cd291e3bd68fe22d1995e59040`

That snapshot includes the detailed July/August implementation decisions, migration/recovery decisions, historical spreadsheet-first architecture, earlier Pro League announcement interpretation and provider-commissioning evidence accumulated before the API-first pivot.

Specialised historical phase documents and migrations also remain in the repository. Historical decisions continue to explain existing code and evidence, but where a historical statement conflicts with a later current decision below, the later decision is authoritative.

The API-first master delivery authority was also recorded in Issue #120 comment `5433304097` on 27 August 2026. This reconciliation incorporates that authority into repository source-of-truth documents.

## Inherited decisions that remain current

### Private single-owner product

- DNA Racing Intelligence is a private decision-support and analytics product for the repository owner.
- Clerk authentication plus server-side owner allowlisting remains required for private website access.
- Owner-scoped relational state remains protected with forced RLS/least-privilege patterns.
- Real owner data, raw API payloads, CSV exports, credentials and owner-specific derived exports must not be committed to Git.
- Tests use deterministic synthetic fixtures.

### Advisory-only scope

- The website may analyse and recommend but must not initiate game or wallet transactions.
- It must not create/submit teams, enter races, place bets, mint, trade, sign with a wallet or execute a splice.
- Genesis burn exclusion remains a hard lifecycle rule.
- Wallet private keys, seed phrases and signing credentials are never requested or stored.

### Historical performance model

- Bike, Car and Horse remain separate performance modes.
- Exact-distance race time/speed is primary historical evidence.
- Ten races per Core × mode × exact distance remains the minimum for a minimally analytical conclusion.
- Finishing, Gold/Blue star and payout-format evidence are supporting dimensions under their existing evidence-quality rules.
- Current-event outcomes and future information must never leak into historical pre-race/backtest features.

### Gold/Blue star authority

- Gold star means the game assessed the Core as having the strongest chance to finish in the top three of that entered field.
- Blue star means the game assessed the Core as having the strongest chance to win/finish first.
- Gold is structurally unavailable at three gates or fewer; derive Gold eligibility from `gate_count > 3` for the historical source contract unless later authoritative API evidence changes the rule itself.
- A one-, two- or three-gate race is never negative Gold evidence.
- Missing/invalid/ineligible/false states remain distinct.
- Historical field strength uses information available before the race.

### Discovery and breeding

- Discovery is targeted and lineage-informed, not random.
- Stop weak paths early and preserve unexpected-elite-upside probes.
- Breeding quality is probabilistic; strong parents do not guarantee strong offspring.
- Offspring class, element, F-number and confirmed family restrictions remain governed by `docs/GAME_RULES.md`.
- Breeding recommendations remain advisory only.

### Economics

- Original asset amounts are preserved exactly; unlike assets are not silently combined.
- Historical race valuation uses dated historical rates, not today's price.
- BGC remains a separate non-cash game credit under the established historical rules.
- Listings are listing facts, not realised income or automatic fair value.
- Missing cost basis remains explicit rather than creating invented profit.

### Delivery controls

- Automatic Vercel Git deployments remain disabled.
- Production schema/data/deployment changes remain explicit owner-approval boundaries even though a private authenticated Vercel application exists.
- Public routes/custom domains and automatic paid-capacity upgrades remain prohibited without explicit approval.
- Focused dependency-ordered pull requests remain the delivery method.

## 2026-08-27 — DNA Open Lab API becomes the preferred data source

- Supersede the spreadsheet-first normal operating model with DNA Open Lab v1 as the preferred game-data source.
- Base URL is `https://api.dnaracing.run/fbike/pub/v1`.
- The target path is `DNA Open Lab API -> server-only client/sync planner -> private R2 evidence/cache where useful -> canonical source adapters -> compact owner-scoped Neon read models/aggregates -> private authenticated website`.
- The browser must never call DNA Open Lab directly or receive its API key.
- Preserve the existing CSV importer as an internal fallback, historical-gap source and API-equivalence harness until connected completeness is proven and through an appropriate transition period.
- Do not continue spreadsheet-specific critical-path optimisation unless a demonstrated API gap requires it.

## 2026-08-27 — API authentication, envelope and rate authority

- Use a server-side Bearer API key only.
- Expected website scopes are `vault`, `races`, `cores`, `tokens` and `splice`; Market is future scope only after DNA implements/publishes it.
- The body envelope `status: success|error` is authoritative, including documented API errors returned with HTTP 305.
- Respect rate-limit metadata and `Retry-After` on HTTP 429.
- Design correctness around the minimum supported tier of 30 requests/minute; 80/150 request tiers may improve speed only.
- Enforce documented bounds: vault info 100, Core bulk 20, race docs/fills 20, finished races 200 per time window and vault search 50.
- Keep optional additive fields attributable without silently assigning new analytical semantics.

## 2026-08-27 — Canonical API boundary

- Provider wire names such as `hid`, `rvmode`, `cb` and other DNA transport vocabulary remain inside the provider adapter.
- Canonical records retain authoritative IDs, source/retrieval timestamps, endpoint/version provenance and deterministic raw-evidence checksum.
- Real API payloads are never committed to Git.
- Persistence/UI mappings must follow connected real-payload evidence rather than guessed nested shapes.

## 2026-08-27 — Tier-1-safe backfill and last-good publication

- Finished-race history uses an adaptive time-window crawler.
- A 200-result finished-race window is considered potentially saturated and must be recursively split until completeness is demonstrable.
- Full race-document hydration uses batches of at most 20.
- All families use durable cursors/checkpoints, idempotent replay and bounded retry/backoff.
- A partial/incomplete refresh cannot replace the last successfully published dataset.

## 2026-08-27 — API/key/tier loss is a sync pause only

- If TierBadge eligibility, key validity or API availability is lost, pause background sync safely.
- Continue serving the last successfully synced dataset and all retained analytics/read models.
- Show clear freshness/staleness/sync-paused status for affected current-state facts.
- Resume/catch up from durable checkpoints when access returns.
- Do not clear data, disable the website, invent a separate degraded-mode product or require immediate owner tier restoration.

## 2026-08-27 — K1 API-key provisioning point

- Request/configure the private hosted website API key after P1/P2 keyless contract/sync foundations are complete.
- The key should carry `vault+races+cores+tokens+splice` scopes.
- Never ask the owner to paste the raw key into chat.
- Key provisioning authorises connected **read-only contract/equivalence discovery only**.
- Key provisioning does **not** authorise persistent real API backfill.
- If the key is unavailable at K1, continue every safe keyless and mocked/read-model task until a live payload dependency is genuine.

## 2026-08-27 — Connected source-authority/equivalence decision

- Before freezing API-specific persistence/UI mappings, P3 must inspect representative real payloads and establish nested/null/optional fields, identifiers, timestamps, natural keys and history depth.
- Privately compare representative API facts against known CSV evidence for race IDs, entrants, times, positions, mode, distance, gates, stars, economics, payout format/tags, Core identity/lineage, Arena and ownership.
- Classify canonical fact families as `API supersedes`, `API supplements`, `CSV-only fallback` or `local strategic state`.
- Differences are explicit review evidence; do not silently choose a source.

## 2026-08-27 — Connected equivalence output is aggregate-only

- Detailed API-vs-CSV reports may contain private entity identities and remain inside the approved ephemeral/private comparison boundary.
- CI logs and repository documentation may receive only count-only summaries grouped by canonical field and entity family.
- Redacted summaries omit entity keys, API/CSV paths, filenames, checksums and scalar values.
- Duplicate entity reports and inconsistent field contracts fail closed before aggregation.
- A safe redaction summary is infrastructure, not equivalence proof; promotion still requires representative private value comparison.

## 2026-08-27 — First successful connected discovery remains non-persistent

- Connected run `33078637484` completed against main commit `4e2f958f6a406183b36f1e69294ed18733a10d0e` using three distinct private keys and one private Vault address.
- The workflow retained only endpoint outcomes, bounded rate metadata, field paths/types and shape fingerprints. It committed no payload values and created no artifact.
- The observed Splice Arena root is a paginated object with `cores`, `has_more`, `limit` and `page`, not a root array.
- Paired authentication calls observed three independent `api_key` counters, each advertising 150 requests/minute. Operational connected discovery remains capped at 30 combined requests/minute; later P4 scheduling may use the proven per-key boundaries deliberately.
- Confirming run `33079595784` recorded `independentRateBucketsProven: true` and `independentRateBucketsEnabled: false`; the temporary automatic trigger was then removed.
- The run proves representative transport and shape contracts, not API-vs-CSV value equivalence, full history depth, successful `pair_validate` semantics or optional Splice document shapes.
- Until those remaining P3 checks are complete, no API fact family is classified as `API supersedes`, and persistent real API sync remains unauthorised.

## 2026-08-27 — Website remains at the base combined API rate

- The connected evidence proves three independent API-key counters advertising 150 requests/minute each, but does not prove that TierBadge level alone determines that entitlement.
- At the owner's direction, normal website and sync execution remains capped at 30 requests/minute combined across all configured keys.
- Higher advertised limits are retained only as redacted observability evidence and cannot automatically raise the default lane or aggregate budget.
- Any future throughput increase requires a separate owner decision and focused reviewed configuration change; it must never alter correctness.

## 2026-08-27 — Connected race metadata must not be mistaken for result coverage

- The successful connected run observed active-race `class` as numeric, `start_time` as null and `end_time` omitted, so canonical adapters preserve those real optional/source-value contracts.
- Hydrated race documents exposed entrants, economics, payout, tags and scheduling metadata but no direct elapsed-time, finishing-position or explicit distance field in the sample.
- `track` remains an unclassified source value and is not interpreted as distance.
- Historical race metadata remains `API supplements`; historical race outcomes/performance remain `CSV-only fallback` unless another authoritative API result contract and private value equivalence are proven.

## 2026-08-27 — Bounded connected history and semantic rejections

- Redacted follow-up run `33088733045` completed 66 read-only probes under the standing 30 requests/minute combined cap with no rate-limit event.
- Finished-race records were returned with verified in-window `start_time` values across five fixed bands from 0–7 days through 730–1095 days old.
- This proves bounded availability into the two-to-three-year band, not complete counts; recent history saturated the 200-record request and older probes were intentionally limited to one record.
- Ten distinct telemetry-benchmark candidates returned HTTP-200 API-error envelopes while ordinary single/bulk telemetry succeeded. Treat benchmark as optional/unavailable for the observed sample rather than a normal-sync dependency.
- Twelve diversified `pair_validate` candidates returned HTTP-200 API-error envelopes. This is semantic rejection rather than transport/schema failure, but it is not successful valid-pair evidence.
- No real payload value, entity identifier, key or Vault address was retained, and no API data was persisted.

## 2026-08-27 — Current API observations cannot leak into historical evidence

- Current power, adjusted odds, variance, stamina, equipped assets, owner/listing state, game racing statistics and current splice state are timestamped current observations.
- They may be displayed separately from historical evidence after connected semantics are proven.
- They must not be joined backward into historical backtests unless an equivalent observation existed before the historical event cutoff.
- Evaluate statistically whether a new current/API evidence family adds predictive lift before assigning ranking weight.
- Do not collapse current and historical evidence into one opaque universal score.

## 2026-08-27 — Persistent real API Preview sync remains a separate owner gate

- API-specific persistence/read models follow P3 connected evidence.
- Before first persistent real Preview backfill, P5 must prove PostgreSQL 18 physical storage and peak behavior including heap/index/TOAST/transient overlap, R2 footprint/cost, restart/replay/idempotency, partial failures, rate limiting, tier loss/reinstatement, catch-up and cached-site availability.
- Require explicit positive headroom below `536870912` bytes for the relevant Neon capacity boundary.
- Present the evidence and **stop for explicit owner approval** before first persistent real Preview sync.
- K1 key availability alone is never sufficient approval.

## 2026-08-27 — Pro League is the first private commissioning milestone

- Absolute delivery priority is the earliest safe private owner-usable Pro League workflow.
- Complete Pro League domain/rules, transparent evidence enrichment, targeted Discovery and official-validation-backed breeding before expanding non-critical website surfaces.
- After owner-approved persistent API sync, commission `/pro-league` with current roster/nucleus/alternates, compliance, roster-size rationale, evidence dimensions, substitution budget/history, Discovery queue, active-race opportunities, breeding queue, official pair viability/cost, structural gaps/marginal slots and sync/freshness state.
- A deliberate protected Vercel Preview deployment is allowed at that major milestone if required; automatic Git deployment remains disabled and Production remains separately gated.

## 2026-08-27 — Current Pro League roster authority

The following current rules supersede conflicting assumptions from the 20 August Community Update:

- My Vault is unlimited.
- A legal Pro League roster contains **12–25 Cores**.
- Roster construction is quality-first: build the strongest nucleus and add only Cores with meaningful incremental value; never force 25.
- Maximum **10 substitutions per year**.
- Whether the initial roster consumes any part of that allowance remains unresolved/configurable until DNA clarifies.
- Maximum **7 Metal**.
- Maximum **8 Fire**.
- Maximum **10 Earth**.
- Maximum **2 Genesis per element**.
- Maximum **5 Cores at F5 or below**.
- Maximum **12 Cores at F10 or below**.
- Minimum **2 Cores above F15**.
- Minimum **8 females**.
- Every rostered Core must be named.

The older `exactly 25`, `minimum five of each element` and `minimum five F15+` assumptions remain historical evidence in the pre-reconciliation Git snapshot and `docs/ESPORTS_PRO_LEAGUE_PREPARATION.md`, but they no longer control validation or advice.

## 2026-08-27 — Pro League persistence and substitution audit

- Persist roster versions, nucleus/optional slots, alternates, reason/evidence snapshots and current compliance state.
- Track annual substitution usage with incoming/outgoing Core, timing, reason/evidence and whether the active authority interpretation counts the change.
- API ownership reconciles current game holdings but must never erase local notes, strategic ME state, Pro League roster/substitution history, Discovery plans or lifecycle strategy.

## 2026-08-27 — Pro League Discovery and active-race opportunity matching

- Convert roster uncertainty/gaps into ranked probes capable of changing roster membership or replacing marginal slots.
- Preserve the ten-race exact-distance analytical minimum and stop weak paths early.
- Use active-race/fill API evidence to surface suitable **manual** racing opportunities where helpful.
- The website may analyse opportunities but must never enter a race.
- Finished-result sync updates historical evidence/readiness automatically after last-good publication.

## 2026-08-27 — Pro League breeding and official Splice evidence

- Derive breeding objectives from structural/performance roster gaps without suppressing exceptional upside.
- Once connected semantics are proven, use current Splice Arena plus official `pair_info` baby element/F/type/cost and `pair_validate` eligibility/viability evidence.
- Combine official current viability/cost with the website's historical lineage/performance/upside research.
- Official viability does not imply strong racing quality.
- The website never initiates the splice/wallet transaction.

## 2026-08-27 — Token prices, listings and market scope

- API token prices are current/reference display context only; historical dated valuation remains authoritative for historical economics.
- A listing price is a listing fact, not automatic fair value, realised income or cost basis.
- Keep only a future Market adapter placeholder until DNA implements/publishes Market scope.

## 2026-08-27 — API licensing and attribution

- Current owner authority permits DNA Open Lab API use only within the stated non-commercial use scope.
- Do not introduce commercial API use without explicit owner approval and any required provider permission.
- API-backed UI must attribute DNA Racing.

## 2026-08-27 — Full private website follows Pro League commissioning

After the private Pro League milestone, continue in this order:

1. API-native My Vault + Core Intelligence.
2. API-native Open Race Intelligence.
3. Full Breeding/Splice.
4. Tournament + Maiden completion.
5. Vault Performance/economics.
6. Lifecycle adviser enrichment.
7. Unified Dashboard/readiness/API operations.
8. Whole-product validation/hardening.
9. Full private website commissioning/handover, with explicit owner Production approval required before controlled Production schema/data/deployment changes.

## 2026-09-01 — Post-critical-path live Open Race recommender

- Preserve API-native Open Race Intelligence as F2, immediately after API-native
  My Vault and Core Intelligence and after the major API history/storage path is
  stable.
- Upgrade the existing manual model to scan all API-visible open races with at
  least 50% of gates filled and at least one place still available.
- Apply every authoritative race restriction before ranking owned Cores,
  including element-only restrictions such as Metal-only.
- Rank payout opportunity from exact-format/exact-distance performance,
  time/speed where valid, variance, sample, freshness and known field strength.
  Keep raw win/podium rates and historical stars as supporting evidence.
- Provide an authoritative direct DNA race link for manual owner entry, but never
  enter a race, connect a wallet or submit a transaction.
- Use bulk-first, change-aware scanning within the shared 30 aggregate
  requests/minute conservative ceiling and retain manual/last-good fallback.
- A changed/full/closed/started race invalidates the prior recommendation. Prefer
  an explicit avoid result when no eligible Core has a supportable payout case.

## 2026-08-27 — API-only critical path; CSV work benched

- At the owner's direction, DNA Open Lab is the sole game-data source on the current delivery critical path.
- Do not request CSV exports or make CSV upload, ingestion, equivalence or fallback proof a prerequisite for P3/P4/P10, Pro League commissioning or full private website commissioning.
- Preserve existing CSV code, synthetic tests and historical implementation evidence without extending or deleting them.
- Move CSV integration and API-vs-CSV comparison to an optional post-critical-path backlog requiring a separate owner decision to resume.
- Connected API families with proven shapes may proceed into persistence without representative CSV value equivalence.
- The observed API still lacks direct elapsed time, finishing position, explicit distance and historical price authority. API-only features must disclose those limitations and must not fabricate values or silently substitute CSV.
- A successful valid `pair_validate` remains required before promoting official pair-viability advice in P9, but it does not block P4 API persistence or P6 Pro League domain work.

## 2026-08-27 — First P4 API sync publication boundary

- Persist API current-state work as immutable owner-scoped generations with separate receipts for Vault, Cores, active races, race fills, Tokens and Splice Arena.
- Publish a generation only when all six required families are complete; a partial candidate never replaces last-good serving data.
- Preserve the accepted/serving generation across rate-limit, API availability and tier-eligibility pauses.
- Use forced RLS, function-only least-privilege runtime access and serializable stage/publish transactions.
- Reject observation/time regression and make published-generation replay idempotent.
- This migration/repository slice is synthetic only. It does not authorise or perform persistent real API backfill; the P5 owner gate remains unchanged.

## 2026-08-27 — Durable finished-race checkpoint and R2 receipt binding

- Persist the existing P2 finished-race checkpoint as compact owner-scoped Neon
  state with compare-and-swap revisions; do not store raw API payloads in Neon.
- A saturated-window split may advance without an R2 receipt because it publishes
  no evidence. A completed non-saturated window may advance only while the verified
  private R2 manifest receipt is recorded atomically in the same serializable
  transaction.
- Bind each immutable receipt to the exact window key, content checksum, document
  count, manifest object key, manifest checksum and manifest byte length.
- Reject checkpoint authority changes, invalid split transitions, counter drift,
  revision conflicts and conflicting receipt replay. Exact retry after an uncertain
  client response remains idempotent.
- Protect checkpoint and receipt tables with forced RLS and function-only
  least-privilege runtime access.
- This is synthetic/replayable P4 infrastructure only. It does not run a real API
  backfill, mutate hosted Neon/R2, deploy Vercel or weaken the P5 owner approval
  gate.

## 2026-08-27 — Pro League team setup and map-line authority

- The owner creates the team and sets the 12–25 Core roster manually on DNA Esports.
- The public Maps page currently defines four of five planned maps: Anchor, Glory, Measure and Miracles.
- Each defined map is an immutable ordered 42-race catalogue for this authority version.
- A match is best-of-three maps; a map is first to 16 race points and must be won by two.
- A staged Core mapping can apply to only one race line or to every line on the selected map with the same exact race type and distance.
- The private website validates and recommends mappings, including first-16 coverage, but never creates a team, submits a roster/mapping or chooses the map for a scheduled match.
- Match schedules are expected about one day in advance and final map choice remains a manual owner action.
- Map 5 remains unavailable and must not be fabricated.

## 2026-08-28 — Generation-bound owned-Core API read model

- Materialize only the P3-proven `vault.cores_full` identity/ownership fields:
  Core ID, display name, class, element, F-number, sex and optional source color.
- Bind every compact row to an immutable API sync generation and its raw-evidence
  checksum; keep the raw response itself outside Neon.
- Require the owned-Core row count to equal the complete `cores` family receipt
  before a materialized generation may publish.
- Revoke runtime access to the older count-only staging function. The runtime may
  stage new generations only through the materialized wrapper, and reads only
  the accepted serving generation through a narrow function.
- Preserve the serving owned-Core snapshot while API/rate/tier sync is paused.
- Do not treat current ownership as local strategy authority: notes, Pro League
  roster versions, substitutions, Discovery and Maiden state remain separate.
- This is synthetic P4 infrastructure only. It does not apply the migration to a
  hosted database, persist a real owner payload, deploy a website or open the P5
  first-real-sync gate.

## 2026-08-28 — Current active-race/fill materialization contract

- Build persistence input only from the P3-proven `races.active` and
  `races.fills` canonical adapters; provider field names and raw responses do not
  cross this boundary.
- Require exact complete-family counts, one unique row per source race ID,
  timezone-qualified observation times no later than the generation cutoff and
  a fill observation backed by an active-race observation in the same generation.
- Preserve null start/end times and the observed race-ID string boundary. Do not
  invent distance from `track`, `cb`, map definitions or endpoint names.
- Preserve fill gate/entrant/confirmation context as a current point-in-time
  snapshot. It is not historical outcome evidence and cannot leak into earlier
  recommendations.
- Sort materialization rows deterministically so replay and future database
  receipt checks are stable.
- Migration `0072` now supplies the generation-bound Neon tables/functions,
  owner RLS, exact receipt checks and serving-generation reads. Hosted migration,
  scheduling and any real owner-data sync remain separate gated work.

## 2026-08-28 — Pro League is Bike-only

- The owner has received clarification that the current DNA Pro League uses
  Bike only.
- Pro League roster ranking, Discovery priorities, race opportunity matching
  and all four published map lineups use Bike evidence only.
- Car and Horse history remains valid for Maiden, general Discovery, breeding
  research and other private website workflows, but cannot affect Pro League
  scores or recommendations.
- Every published Pro League map race line is explicitly modelled as Bike. A
  future additional mode requires a new versioned authority change; it is not
  anticipated or inferred now.

## 2026-08-28 — Two-Vault matchups, home map control and gap discipline

- A Pro League matchup is between two Vaults and every Bike race field is split
  equally between them.
- Each Vault preselects mapped Cores from its registered 12–25 Core roster.
- The home Vault selects the maps raced in the matchup.
- Add opposition-aware exact race-type-plus-distance analysis, home-map ranking
  and away-match defensive preparation. Missing opponent evidence stays unknown.
- Identify weak and unproven map demands. “Best in our Vault” is not equivalent
  to strong: weak best-available Cores should be tested against alternatives or
  addressed through breeding before roster lock.
- Do not consume a roster place merely to cover a weak theoretical gap. If
  structural rules make temporary inclusion unavoidable, mark the Core
  provisional and replacement-priority. Preserve the maximum 10 annual
  substitutions for evidence-backed improvement.

## 2026-08-28 — Public source repository is owner-approved

- The owner explicitly approved keeping the GitHub source repository public so
  GitHub Actions availability is not constrained by private-repository minutes.
- Repository visibility is not a blocker for API-first development, hosted
  persistence or commissioning.
- Public DNA game/Vault facts do not make credentials public. API keys,
  provider/database credentials, session secrets and signing material must
  remain server-side and must never enter source, logs, artifacts or frontend
  bundles.
- Continue avoiding committed raw provider responses. Persist compact canonical
  read models in Neon and immutable evidence in the approved R2 boundary.

## 2026-08-28 — Pro League selection is performance-led, not win-rate-led

- Raw win and Top-3 rates are descriptive supporting evidence only. Weak
  opposition and off-distance Discovery entries can make those rates misleading.
- For every published Bike race type and exact distance, compare Cores against
  the matching overall DNA population using authoritative elapsed-time central
  tendency, valid derived speed, variance/consistency, sample size and freshness.
- Candidate ordering uses population benchmark band, median and trimmed-mean
  elapsed time, standard deviation/interquartile range, then sample/freshness.
  A single fastest run and raw outcomes cannot override materially weaker
  sustained performance.
- Gold/Blue stars and wins or Top-3s against independently evidenced strong
  opposition may support confidence but remain separate from intrinsic
  performance. They may break an otherwise equal intrinsic-evidence tie; raw
  win/Top-3 totals do not. Missing opposition-quality evidence is unknown, never
  favourable.
- “Best currently owned” is not a population strength label. A weak
  best-available Core remains provisional/test-before-lock and routes to focused
  Discovery or breeding so the annual 10-substitution budget is not wasted.
- The current API observation still lacks authoritative finished-race elapsed
  time, result and explicit distance fields. The API-only website must disclose
  that limitation until a supported contract exists; this decision does not
  re-authorise CSV ingestion on the critical path.

## 2026-08-28 — Supplemental Core API values remain current source values

- Establish canonical adapters for the connected racing-stats, power, listing,
  attached-assets, owner, stamina and splicing Core families before persistence.
- Bind each canonical observation to its Core ID, endpoint, observation time and
  raw-evidence checksum.
- Preserve undocumented nested provider values as validated JSON source values.
  Do not claim that API power, adjusted odds or variance means race time, speed,
  consistency or predictive strength.
- Preserve omitted listing fields as omitted instead of inferring listed or
  unlisted state. Preserve zero, false and null distinctly.
- Treat all seven families as current state. They cannot enter historical
  ranking or backtests without an observation before the event cutoff and a
  separate evidence-backed feature-authority decision.
- This canonical adapter slice uses synthetic fixtures only. Generation-bound
  Neon persistence, workers and real owner-data synchronization remain gated.

## 2026-08-28 — Supplemental Core refresh is one complete generation

- Bind racing stats, power, listing, attached assets, owner, stamina and
  splicing observations to the exact same owned-Core ID set and generation.
- Require every family to contain every owned Core exactly once. Missing,
  duplicate and extra identities fail the entire materialization.
- Validate source/version/scope/endpoint, entity keys, evidence checksums and
  observation chronology before producing persistence input.
- Sort every family deterministically by canonical numeric Core ID for stable
  replay and database receipt comparison.
- Do not publish a mixed-generation or partial supplemental Core view. Preserve
  the previous last-good serving generation instead.
- This materialization uses synthetic evidence only. It does not add Neon
  tables, call DNA Open Lab or open the P5 real-data gate.

## 2026-08-28 — Dynamic discovery resumes from verified immutable evidence

- Execute ownership, active-race and first-page Arena discovery as a minimal
  deterministic child cycle, followed by at most one next-page request per
  selected mode in each continuation child cycle.
- Derive child cycle IDs from the root cycle and round so a restart finds the
  same owner-RLS compare-and-swap checkpoints instead of creating parallel
  discovery authority.
- Persist every accepted request through the private immutable R2 sink before
  advancing its child checkpoint. Reconstruct assembly observations only
  through a reader that verifies private bucket state, owner/cycle/request key,
  receipt and head checksums, exact metadata, bounded bytes and embedded JSON
  identity.
- A discovery step performs at most one network request. Completed child cycles
  can be replayed without another request, and the final result is the immutable
  input plan for the normal cadence/acquisition/publication path.
- Discovery does not publish a generation, mutate hosted providers or authorize
  persistent real owner data. Final materialization/publication wiring and the
  P5 first-real-sync approval gate remain separate.

## 2026-08-28 — Full-cycle publication requires exact immutable receipts

- Reconstruct the initial/full current-state generation only from an exact
  `all_current_state` schedule and a matching `ready_to_publish` durable
  checkpoint.
- Re-read every receipt through the private immutable evidence boundary and
  bind the embedded cycle, group and logical request back to schedule authority
  before adapting any result.
- Canonicalize owned Cores, active races/fills, all seven supplemental Core
  families, Token prices and complete Arena pagination before making exactly
  one call to the atomic Neon publication repository.
- Do not infer that a non-due family is reusable from freshness time alone.
  Staggered cadence publication remains fail-closed until a durable receipt
  index identifies and verifies each cached family observation.
- This slice is synthetic/replay only. It performs no DNA request or hosted
  write and does not open the P5 first-real-sync approval gate.

## 2026-08-28 — Staggered cadence carries receipt authority, not timestamps

- Define the complete expected receipt set from the immutable current-state
  plan, excluding on-demand pair requests.
- For each due group, accept receipts only from the current exact-schedule
  `ready_to_publish` checkpoint. For each non-due group, accept receipts only
  from the validated prior last-good receipt index.
- Preserve source cycle, logical request key, observation time, content
  checksum and private evidence object key per entry so every carried family
  can be re-read and verified.
- Reject missing prior authority, plan/request drift, duplicate keys, future
  observations and partial due-group coverage. A family freshness timestamp is
  never enough to reconstruct a generation.
- This contract is synthetic and provider-neutral. Owner-RLS Neon persistence
  and atomic publication binding are the next P4 slice; P5 remains closed.

## 2026-08-28 — A published generation retains its exact receipt index

- Persist the full-plan current-state receipt index as one compact document
  keyed by owner and candidate generation, with forced owner RLS and no direct
  runtime table access.
- Validate bounded receipt structure, checksums, source cycles, observation
  chronology and unique logical request keys before storing it.
- Stage canonical data and the receipt index inside the same serializable
  transaction. Publish only through an indexed-generation function, and revoke
  runtime execute privilege on the older unindexed function.
- Make identical replay idempotent, reject changed replay and read an index
  only through the current last-good generation pointer.
- This remains synthetic/local evidence. It makes no API or hosted-provider
  change and does not open the P5 first-real-sync gate.

## 2026-08-28 — Staggered publication replays every carried receipt

- Read cached-family authority only from the owner-scoped serving-generation
  index; caller timestamps or an arbitrary prior document are not authority.
- Build one new full-plan index by replacing due groups from the current exact
  checkpoint and retaining non-due groups from that validated last-good index.
- Re-read every referenced private R2 object using the receipt's original cycle
  and require its group, request key, observation and request body to match the
  reconstructed full plan.
- Run the same complete Core, race/fill, supplemental, Token and terminal Arena
  materialization checks as a first/full cycle, then publish exactly once
  through the indexed atomic repository.
- Any missing prior index, receipt drift, incomplete family or publication
  error leaves the existing serving generation unchanged. This remains
  synthetic and does not open P5.

## 2026-08-28 — Scheduled cycles derive cadence from serving evidence

- Treat the owner-scoped serving receipt index as the only authority for
  per-family completion times; caller-maintained freshness timestamps cannot
  suppress an API request.
- A dynamic ownership, active-race or Arena plan hash change invalidates cached
  cadence and forces a full cycle.
- Advance at most one bounded API request per coordinator invocation through
  the durable compare-and-swap checkpoint and immutable evidence sink.
- Record API interruption recovery in both the cycle checkpoint and last-good
  sync state, then select full or staggered publication only from a verified
  ready checkpoint.
- This coordinator remains synthetic/local and does not cross the P5 gate.

## 2026-08-28 — One operator composes discovery and scheduled publication

- Run dynamic ownership, active-race and terminal Arena discovery first, using
  deterministic child cycles under the requested root cycle.
- Only a complete authoritative discovery plan can enter scheduled acquisition
  and publication.
- A discovery invocation that performs a request returns immediately; when a
  completed discovery falls through to scheduling, discovery has performed no
  request during that invocation. The full operator therefore remains bounded
  to one API request per invocation.
- Both discovery and scheduled interruptions use the same owner-scoped
  last-good pause path. This remains synthetic and does not open P5.

## 2026-08-28 — P4/P5 readiness is an explicit evidence matrix

- Keep locally proven recovery implementation distinct from connected private
  Preview acceptance and physical/cost measurements.
- Require all seven P5 technical requirements to be satisfied before asking the
  owner for first-persistent-sync approval.
- Even complete technical evidence does not authorise persistence: the owner
  approval remains a separate positive gate.
- P5 can never authorise Production; Production remains a later separate gate.
- The current matrix is closed because connected recovery, PostgreSQL 18
  physical/peak, private R2 cost and positive Neon headroom evidence are pending.

## 2026-08-28 — Recovery acceptance runs through one bounded harness

- Execute the ten accepted recovery cases in a fixed order, one case per
  invocation, under an exact code head and provider scope.
- Local runs allow no provider writes. A bounded private Preview case may make
  at most four synthetic provider writes and must leave zero residue.
- Every case remains limited to one DNA API request and zero persistent real
  owner-data writes.
- Reject raw payloads, secrets, changed head/scope, out-of-order checkpoints and
  completed-checkpoint replay from the evidence report.
- A complete local report remains local evidence only and cannot open P5.
- Require a case-specific assertion adapter between each scenario executor and
  the generic harness so generic success cannot substitute for the required
  receipt, checkpoint, retry, pause, atomicity or plan-drift outcome.

## 2026-08-28 — API-only capacity evidence uses an exact measurement contract

- Bind PostgreSQL 18 physical/peak and private R2 evidence to one exact code
  head, complete acquisition-plan checksum, provider scope and timestamp.
- Use the maximum sampled database size—not settled size—for Neon headroom, and
  keep zero headroom blocking against the 536,870,912-byte boundary.
- Require owner heap, index and TOAST bytes plus multiple transient samples.
- Project private R2 retained bytes and Class A/B operations using a dated price
  authority supplied at measurement time; do not hard-code provider pricing.
- A connected passing capacity report may update only P5 capacity evidence. It
  cannot authorise persistence, Production or any external transaction.

## 2026-08-28 — Recovery assertions are derived from component observations

- Run each recovery case through a case-bound component scenario and derive
  its trace from raw receipt/checkpoint identities, serving pointers, retry
  timestamps, staging/commit counters and plan checksums.
- Do not accept a generic pass, recovered or authority-preserved flag from a
  scenario implementation.
- Keep the existing one-request, zero-real-owner-write, exact-head and
  provider-scope harness limits authoritative after component derivation.
- This remains local synthetic implementation evidence. It neither satisfies
  connected private Preview acceptance nor opens P5.

## 2026-08-28 — Capacity measurement is bounded and cleanup-enforced

- Read PostgreSQL major version and physical database/relation sizes through a
  measurement port; the synthetic cycle only selects transient sample points
  and cannot supply the measured byte values.
- Require baseline, component-triggered transient and settled samples, using
  their maximum for Neon headroom.
- Enumerate only a private R2 bucket through bounded pagination, reject repeated
  cursors or object identities and retain only redacted identity hashes and
  byte counts in measurement evidence.
- Always execute synthetic cleanup, including after measurement failure, and
  reject residue, persistent owner-data writes, raw payloads or secrets.
- Local runner evidence remains insufficient for P5; connected provider
  measurement and review are still required.

## 2026-08-28 — Capacity provider reads are least privilege and owner confined

- Execute every PostgreSQL capacity observation in a new serializable read-only
  transaction after verifying owner scope, the exact runtime role and the
  absence of superuser, RLS-bypass, role/database/schema creation authority.
- Measure only an explicit allowlist of `dna` owner relations and reject partial
  catalog coverage.
- Enumerate R2 only through the hashed DNA Open Lab owner prefix and never emit
  raw keys, bodies or metadata values from the adapter.
- Count returned application HTTP/custom metadata key/value bytes exactly; do
  not invent provider-internal metadata overhead or undocumented billing
  semantics.
- These adapters are implementation evidence only. Connected synthetic
  measurement, cleanup evidence and review remain required before capacity
  rows can change.

## 2026-08-28 — Connected capacity composition cannot weaken evidence scope

- Fix the connected entry point to `private_preview`; do not accept a caller
  supplied provider scope.
- Construct both Neon and R2 ports inside that entry point so connected reports
  cannot substitute permissive measurement ports.
- Bind PostgreSQL relation measurement to the complete DNA Open Lab inventory
  through migration `0076`; schema drift or missing coverage fails closed.
- A successful composed report can update only the three reviewed capacity
  rows. It still cannot authorise persistent sync or Production.

## 2026-08-28 — Connected capacity evidence is emitted through a whitelist

- Require a dedicated invocation authority and exact expected head before any
  connected capacity provider is accessed.
- Invoke only the guarded private Preview composition; local scope and injected
  measurement ports are not accepted at this boundary.
- Emit one canonical record capped at 16 KiB. Preserve reviewed measurements,
  costs, timestamps, checksums and safety conclusions only.
- Hash measurement and price authority references with separate domains. Never
  emit provider configuration, credentials, owner/database/bucket/object
  identities, cursors, payloads or provider error details.
- Emission can support review of the three P5 capacity rows only. It cannot
  authorise persistent Preview sync or Production.

## 2026-08-28 — Connected capacity uses a fixed rollback-only workload

- Remove caller-supplied synthetic-cycle and cleanup callbacks from the guarded
  private Preview composition.
- Generate one non-owner all-family candidate and execute the production atomic
  publication repository inside a serializable transaction.
- Capture the transient PostgreSQL sample before replacing the repository's
  final commit with rollback, then prove the synthetic generation is neither
  accepted nor serving.
- Create one bounded JSON R2 marker beneath the hashed owner prefix, verify its
  checksum/metadata, include it in the footprint and delete it during mandatory
  cleanup. Existing markers and any residue fail closed.
- This can produce connected capacity evidence only. It does not persist real
  owner data, open P5, authorise Production or perform a DNA transaction.

## 2026-08-28 — Provider prerequisites are a separate read-only gate

- Add a dispatch-only provider preflight before the connected P5 capacity run.
- Reduce observations to counts, booleans and stable blocker IDs; never emit
  provider configuration, owner/database/bucket/object identity or errors.
- Require PostgreSQL 18, exact owner binding, least-privilege runtime, all 15
  API-only relations, all 13 runtime functions, legacy publisher revocation,
  private R2 access and no synthetic marker residue.
- The first read-only Preview observation found PostgreSQL 18 but 0/15 required
  API-only relations. Migrations `0069`–`0076` must be applied and reviewed on
  private Preview before measurement. This finding does not authorize that
  measurement, persistent real owner-data sync or any Production change.

## 2026-08-29 — Connected capacity measurement is exact-main and cleanup-gated

- Record that private Preview migrations `0069`–`0076` were applied and
  smoke-tested without owner-data persistence. Exact-main prerequisite run
  `33224616911` subsequently passed PostgreSQL 18, 15/15 relations, 13/13
  functions, restricted owner/RLS access, private R2 access and zero residue.
- Permit the rollback-only connected capacity composition only through a
  dispatch-only exact-main workflow that rejects stale dispatches, re-runs the
  prerequisite proof before measurement and the cleanup/safety proof afterward,
  and rejects evidence if `main` advances during the run.
- Upload a sanitized capacity artifact only when both the measurement and
  cleanup succeed; cap retention at seven days.
- Hash a fixed 30-day projection at the conservative 30 aggregate
  requests/minute ceiling: 1,296,000 Class A writes and 2,592,000 Class B
  verifications. Use Cloudflare's 2026-08-07 R2 price authority: $0.015 per
  GB-month, $4.50 per million Class A and $0.36 per million Class B, without
  subtracting the free tier.
- This workflow can update only the three P5 capacity evidence rows after
  review. It cannot authorize persistent owner-data sync, Production or a DNA
  transaction.

## 2026-08-29 — Rollback settlement does not require durable database growth

- Connected run `33227016073` failed safely in the capacity measurement while
  prerequisite checks, mandatory cleanup and final exact-main proof passed. It
  retained no evidence artifact and left no synthetic residue.
- A forced rollback may legitimately settle at the pre-cycle baseline. Reject
  only a settled reading below baseline; do not require durable growth from a
  transaction whose commit is deliberately intercepted and rolled back.
- Continue requiring a component-triggered transient sample, intercepted
  commit, rollback, complete owner-relation measurement, substantive private R2
  footprint and zero-residue cleanup before capacity evidence can be emitted.
- Connected logs may emit only fixed allowlisted progress-stage identifiers.
  Measurements, provider identities, configuration, errors and payloads remain
  prohibited from workflow output.

## 2026-08-29 — Connected capacity evidence satisfies three P5 rows

- Accept exact-main connected run `33227770750` at
  `c8e81713ebccf6b781a1d6dc22aa3093ae3ad705` as authority for PostgreSQL 18
  physical/peak storage, private R2 footprint/cost and positive Neon headroom.
- Bind the conclusion to artifact digest
  `sha256:3c9b47aff03ee63554eabf249304fd2f9009c7075c3ba407149ee3dac36823b9`
  and canonical evidence checksum
  `f545f2b247270b2098e9337485514f1e7e36a45caedd80e92797add7ee859bf8`.
- Record a 17,768,448-byte PostgreSQL peak, 519,102,464 bytes of positive
  headroom, a 300-byte bounded synthetic R2 footprint and a 6,765,121 micro-USD
  30-day projection. The marker and rollback generation left zero residue.
- Keep persistent private Preview sync and Production disallowed. Capacity is
  complete, but all four connected recovery requirements remain blocking.

## 2026-08-29 — Esports trial operations are versioned match authority

- Accept the public DNA Esports pages and the owner's supplied trial
  announcements as authority for observed trial operation, without evaluating
  the randomly selected practice Cores.
- Team setup remains manual: create the team, register 12–25 named Cores and
  save assignments for all four published 42-race maps. Assignments persist
  across matches, remain editable until lock and can expand only within one map
  to the same exact race type and distance.
- Supersede the earlier shorthand that the home Vault controls all maps. The
  home Vault picks map 1 and denies one map; the away Vault then picks map 2
  from the two maps left by that action.
- Require the actual match ruleset for map 3. Reviewed live pages conflict:
  one permanently excludes the denied map, while another returns it to a
  two-map random pool under the rule in force for that match. Preserve both
  versioned policies and never invent one universal rule.
- A map stops at 16 or more race points with a two-point lead and continues at
  16–16. A best-of-three match stops at two map wins. If all 42 catalogue races
  are exhausted without win-by-two, keep the resolution unknown until DNA
  publishes it.
- Keep Core result, team race-point winner, map score, match result and league
  points separate. The trial standings currently show 3/1/0 league points and
  the displayed tie-break sequence points, event wins, race differential, then
  race wins.
- Treat practice payouts, unlimited pre-lock roster edits, disabled ageing,
  day-as-Week tabs and missed-pick fallbacks as trial-only observations. They
  cannot become permanent season rules silently.
- The live trial roster page shows a 32%-rounded-up female minimum, which
  conflicts with the current owner-confirmed minimum eight. Retain the trial
  observation, but keep the owner-confirmed validator until explicit final
  authority changes it.
- The current public page contains four maps. Do not retain the earlier
  assumption that a fifth map is planned, and do not configure an additional
  map until it is published.

## 2026-08-29 — Recurring API refreshes must remain zero-cost

- Treat the 30 aggregate requests/minute value as a burst ceiling during a
  bounded refresh, not a continuously running website cadence.
- Target one complete API refresh every 24 hours. When any recurring family is
  due, reacquire every recurring family and publish only the complete valid
  generation.
- Resume finished history from durable checkpoints and retrieve only
  missing/new evidence after the initial backfill. Preserve complete history
  exposed by the API and identify current-state-only endpoints explicitly.
- Keep R2 Standard recurring operation below hard 80%-of-free-tier budgets:
  8 GB retained storage, 800,000 Class A and 8,000,000 Class B operations per
  billing window. Cap a planned daily refresh at 1,000 Class A and 2,000 Class B
  operations.
- Evaluate current plus proposed usage before discovery/acquisition. If any
  budget would be crossed, perform no provider work, keep serving last-good data
  and catch up later. Never enable paid usage or capacity automatically.
- Treat the first persistent historical API backfill as a separate bounded
  commissioning event. A small one-time charge may be proposed only with a
  measured upper bound, an exact maximum amount, cleanup/stop conditions and
  explicit owner P5 approval.

## 2026-08-29 — Pro League female minimum is percentage-based

- The owner confirmed that at least 32% of the selected 12–25 Core roster must
  be female, with the result rounded up to a whole Core.
- A 12-Core roster therefore requires 4 females; a full 25-Core roster requires 8. Intermediate roster sizes use the same `ceil(roster size × 0.32)` rule.
- This supersedes the earlier fixed minimum-eight interpretation for current
  validation. The fixed figure remains only in historical announcement
  snapshots where appropriate.
- Roster audits must calculate the required female count from the actual valid
  selected roster size and explain both the percentage and rounded result.

## 2026-08-29 — Discovery is mode-aware and normal-Free is name-authoritative

- Preserve the existing shared Horse, Car and Bike exact-distance Discovery
  model. The Bike-only Pro League boundary does not restrict general Discovery.
- Classify a normal-Free race only when the authoritative race name contains
  the standalone token `Free`, case-insensitive. Zero price, subsidy or free
  tournament entry is not classification authority.
- Keep normal-Free, competitive, tournament, esports and parent/lineage
  evidence separately auditable. Normal-Free outcomes cannot update displayed
  power, adjusted odds or profile variance; speed and repeatability are primary
  and placing is secondary.
- Retain the existing ten-race exact-distance analytical boundary. Add a
  separate owner-configurable target of twenty usable normal-Free observations
  per owner, Core, mode and selected exact distance; existing valid observations
  reduce the remainder and completion does not reopen automatically.
- Permit any number of preferred `TEST` distances. Only when none passes the
  transparent evidence gate, assign exactly one short, middle and long
  exploratory `SCREEN`; never present a screen as preferred.
- Adopt the owner-reviewed Bike study distances and non-overlapping bands in
  `DISCOVERY_NORMAL_FREE_STUDY.md`. Leave Horse and Car configurations
  authority-pending rather than copying Bike distances.
- Record the source conflict: the historical archive has finished times but no
  authoritative race name, while observed API race documents have names but no
  authoritative finished time/distance outcomes. Keep existing rows unknown.
  Defer persistence migration until joined source authority and P5 permission
  exist; do not manufacture classifications or change the measured P5 storage
  inventory prematurely.

## 2026-08-31 — Connected recovery safety uses bounded Neon/R2 fingerprints

- Inspect the fixed API-only owner relation groups through the existing
  least-privilege runtime role in one serializable, read-only, owner-scoped
  transaction. Reduce rows to ordered per-relation digests before they leave
  PostgreSQL; never emit source rows or provider errors.
- Migration `0077` grants the runtime role execution of that one owner-scoped
  fingerprint function while preserving the existing prohibition on direct
  table reads. Its smoke evidence proves group isolation, owner isolation,
  apply, reversal and removal.
- Keep owner data, acquisition checkpoints, last-good serving state and
  retained evidence as separate SHA-256 fingerprints so one category cannot
  hide drift in another.
- Inspect R2 only below the hashed owner prefix. Treat `p5-recovery/` as the
  sole temporary connected-recovery namespace and fingerprint all other owner
  objects as retained evidence.
- Permit cleanup only below that temporary namespace, cap the inspection and
  deletion set at 10,000 objects, and require a post-delete empty re-list.
  Never delete retained evidence.
- Combine the Neon and R2 retained-evidence fingerprints before applying the
  existing guarded before/after equality check. Any malformed response,
  privilege mismatch, pagination error, provider error, cleanup error or
  residue fails closed with a redacted stable error.
- This supplies provider safety and cleanup ports only. It does not execute a
  connected recovery case, call DNA Open Lab, persist owner data, open P5,
  authorise Production or change any provider.

## 2026-08-31 — Runner stars require pre-race opposition adjustment

- Confirm Blue as the game's highest assessed first-place chance and the visible
  Yellow star as its highest assessed top-three chance. Preserve the historical
  source name `gold_star` even when the UI says Yellow.
- Keep raw assignment rate and Yellow top-three/Blue win conversion as
  diagnostics only. They receive no positive elite-racer, esports, Discovery
  or breeding weight when opposition quality is weak or unknown.
- Derive opponent strength from same-mode/exact-distance evidence frozen
  strictly before the event. The initial policy requires 10 prior races, calls
  the 75th percentile strong and the 90th percentile elite, and calls a field
  weak only when every opponent is known and the strongest is at or below the
  50th percentile.
- Weight positive assignments from zero at the 50th opponent percentile to one
  at the 100th. Keep Yellow and Blue measures separate and expose raw counts,
  denominators, quality coverage, strong/elite assignments and strongest named
  opponent examples.
- A star over an independently established elite marathon Core such as Yankee
  Trek is strong supporting evidence; the model proves that opponent's prior
  percentile and never hard-codes a name bonus.
- Discovery may promote an under-tested exact-distance probe from strong-field
  star support. Esports may use only adjusted stars after intrinsic evidence
  ties. Breeding may show adjusted stars in the direct-racer case, but breeder
  quality cannot inherit the signal without chronological offspring holdout
  lift.

## 2026-08-31 — Real Pro League ageing and 25-Core owner strategy

- Real Pro League ageing is enabled, but roster registration itself is
  age-neutral. A Core incurs ageing only when it runs a mapped race.
- Target a full 25-Core owner roster made from proven Pro League specialists,
  credible rotation/developing Cores and structural or exact-line coverage
  specialists. This owner strategy does not change the legal 12–25 range.
- Exclude irreplaceable normal-tournament Cores by default so the Vault's best
  cash-prize capacity is not spent in Pro League. Include one only as an
  explicit high-importance contingency when its expected map impact justifies
  the ageing exposure.
- Track registration, mapped starts and ageing separately. Spread justified
  starts across real depth; do not invent an ageing exclusion number before
  exact increments, thresholds and season mechanics are authoritative.
- Pro League results may strengthen evidence incidentally for credible
  developing Cores that are raced for a competitive reason. Pro League is not
  a Discovery programme after a Core has been properly assessed; deliberate
  testing stays in the shared mode-aware normal-racing Discovery workflow.

## 2026-08-31 — Pro League and Esports are one competition

- Treat `Pro League` and `Esports` as synonymous names for the same Bike
  competition. Do not model, rank or present them as separate programmes.
- The DNA Esports website is the operating surface for Pro League team, roster,
  map and match actions.
- Trial Esports is a practice ruleset of the same competition. Its temporary
  ageing, roster-edit and prize overrides remain versioned trial facts, not a
  separate racing mode.
- Normal tournaments and general mode-aware Discovery remain separate from
  Pro League/Esports.

## 2026-08-31 — Season 12 official tournament calendar is recorded

- Accept the owner-supplied official Season 12 schedule image as calendar
  authority for 17 dates from 14 September through 9 November 2026.
- Resolve the omitted printed year as 2026 because every month/day matches its
  published weekday in the current Season 12 planning context.
- Preserve the exact published distance shorthand and also normalize it through
  the already confirmed `10 = 1000 m` through `22 = 2200 m` mapping.
- Record three Splice dates, nine named mode/distance competition entries and
  five Side Events. Keep Side Event mode, distance and eligibility unknown.
- Do not infer gate counts, fees, scoring, qualification windows, leaderboard
  rules or missing eligibility from this calendar. It is prefill authority, not
  a complete actionable Tournament configuration.
- Keep normal Season 12 tournaments separate from the Bike-only Pro
  League/Esports programme and its ageing-aware roster strategy.

## 2026-08-31 — Core profiles include API-backed Esports history

- Accept the owner's DNA confirmation that normal public Core profile pages do
  not contain Pro League/Esports races or per-Core Esports statistics.
- Treat that omission as incomplete public-profile coverage, never as evidence
  of zero Esports starts or performance.
- Retrieve the complete available supported-API Esports history, deduplicate it
  by stable race-plus-Core identity and include every completed entry in
  whole-Core analysis because intrinsic Core traits/performance do not change
  between normal racing and Pro League/Esports.
- Preserve All evidence, Normal racing and Esports views. Partition Esports by
  exact race type and exact distance, retain separate lane counts/outcomes and
  disclose missing time, result, opposition or history-depth fields.
- Do not bypass P5: this decision adds the analytical contract and private UI
  lane but does not authorize the first persistent real API backfill.

## 2026-09-01 — Connected recovery failures expose only allowlisted locations

- Run `33462097918` passed exact-main and provider prerequisites but failed the
  ordered recovery and mandatory cleanup steps without exposing a useful
  failure location.
- Report only a fixed phase, completed-case count and next canonical case in
  connected failure logs. Never accept or emit provider errors, identities,
  object keys, URLs, payloads or configuration in this diagnostic boundary.
- Keep every recovery, cleanup, exact-main and zero-residue requirement
  fail-closed. Better diagnostics do not convert a failed run into evidence and
  do not authorize real-data persistence, Production or game actions.

## 2026-09-01 — Exact-main connected recovery completes P5 technical evidence

- Accept connected run `33467686923` at
  `0371dbb32f5cd0d56f4a41e61ee14ad399630945` as authority for all four P5
  recovery requirements after the fixed ten-case suite passed in order.
- Bind that conclusion to artifact
  `github-actions:artifact/9785468669#sha256:4bdcb895a49211b168ea85e147a570ab07fbc14bba4715854411812b5e751ce0`,
  terminal report checksum
  `d5f5f5f3b449b551a22fafa702cbe50481184bf711c5c04ee1e25b97c701f878`
  and connected-evidence checksum
  `a4b0826fe2f641dc7110f7584d88c84adbf7650927795b8ad391a839697e500d`.
- Every case retained last-good authority, performed zero persistent owner-data
  writes, emitted no raw payload or secret material and left zero temporary R2
  residue. Final owner-data, checkpoint, serving and retained-evidence
  fingerprints matched their starting values.
- All seven P5 technical requirements are now satisfied. The first persistent
  private Preview backfill remains prohibited until an exact-main
  non-persistent complete-inventory measurement supplies the one-time API/R2/
  Neon upper bound and the owner explicitly authorizes the presented maximum.
- Record the owner's general approval intent for real API data as intent only;
  it is not an unbounded cost authorization and cannot substitute for the
  measured amount required by the existing P5 commissioning contract.

## 2026-09-01 — First-backfill measurement evidence is aggregate-only

- Require the non-persistent complete-inventory measurement and its connected
  recovery authority to bind to the same exact clean `main` commit.
- Emit only the six reviewed source-family counts, request/storage/operation/
  Neon bounds, cost components, point-in-time cutoff and plan checksum.
- Hash family evidence, connected-recovery run and pricing references with
  separate domains. Never emit raw payloads, credentials, provider
  configuration or Vault/Core/race/object identities.
- Cap the canonical sanitized artifact at 32 KiB and fail closed before
  emission on changed authority, incomplete inventory, persistent writes,
  residue, stale pricing, exhausted Neon headroom or unsafe output.
- This boundary prepares evidence only. It does not call DNA Open Lab, perform
  the inventory, record bounded owner authorization, enable persistent Preview
  backfill or permit Production.

## 2026-09-01 — First-backfill inventory uses one guarded orchestration path

- Execute the six reviewed measurement families in fixed authority order and
  require every API request to pass through the conservative client pool.
- Keep independent-bucket execution disabled for commissioning measurement,
  even though connected evidence proves three independent provider counters;
  no measurement request may raise the 30 aggregate requests/minute ceiling.
- Count actual pool requests and serialized response bytes inside the runner.
  Reject terminal family evidence whose source, API or retained-R2 upper bound
  understates what was observed.
- Always verify zero persistent owner-data writes, zero temporary provider
  residue and absence of raw/secret artifact content before invoking the
  aggregate-only measurement emitter.
- Endpoint-specific pagination, cutoff and storage/Neon upper-bound adapters
  remain a separate connected workflow slice. The guarded runner alone does
  not call DNA Open Lab, open P5 or authorize persistent Preview data.

## 2026-09-01 — First-backfill endpoint inventory is terminal and read-only

- Acquire finished-race history with the existing adaptive 200-row window
  crawler from an explicit history start through the exact authority cutoff.
  A saturated minimum-width window remains blocking rather than being treated
  as complete.
- Measure current state through the supported API only: active races plus
  batched fills, token prices, four Vault identity/recent endpoints, all eight
  owned-Core bulk endpoints in batches of 20, and every Bike/Car/Horse Arena
  page through authoritative `has_more: false`.
- Keep the six-family order fixed and carry discovered owned-Core identity only
  in memory into the Core family. Reject malformed or repeated identity,
  out-of-plan responses, Arena page/limit drift and pagination overrun.
- Reduce endpoint observations to record/request/byte counts, terminal-unit and
  split counts and an aggregate SHA-256 reference. Raw payloads and owner,
  Core, race and listing identities never enter the sanitized evidence.
- Require a separately reviewed upper-bound projection callback for retained
  R2 bytes, Class A/B operations and compact Neon growth. Endpoint coverage
  alone cannot choose storage multipliers or authorize persistent Preview
  writes.

## 2026-09-01 — Conservative first-backfill provider projection policy

- Convert only terminal six-family API observations; the policy cannot make an
  API request, write a provider or authorize persistence.
- Retain one uncompressed immutable R2 evidence object per logical request with
  a 16 KiB canonical envelope allowance. Allow one complete API/PUT replay, two
  paginated R2 audit listings and six Class B integrity/reconstruction reads per
  logical object. Reject any observation whose largest response plus envelope
  would exceed the existing 8 MiB immutable evidence-object boundary.
- Project compact-Neon incremental physical peak as the larger of six times
  observed response bytes or 2 KiB per source record, then add 32 KiB per
  logical request and 1 MiB per family for control rows and indexes. This
  includes explicit heap/index/TOAST and candidate/last-good overlap allowance
  without claiming raw response bodies are stored in Neon.
- Keep provider prices outside the policy. Fresh dated Cloudflare, DNA API and
  Neon price authorities remain inputs to the exact-main measurement packet.
- Treat the result as a conservative plan bound, not capacity evidence. The
  512 MiB Neon headroom check, provider budgets, connected recovery proof and
  exact bounded owner approval remain mandatory before the first persistent
  private Preview backfill.

## 2026-09-01 — First-backfill measurement is recovery-first and exact-main

- Compose the reviewed projection policy into one dispatch-only protected
  workflow that accepts only current `main` and fails if main changes during
  execution.
- Re-run provider prerequisites and the complete ordered connected recovery
  suite before the real read-only inventory. Cleanup is mandatory even after a
  failed recovery case, and measurement cannot start until recovery and cleanup
  both pass.
- Keep all three private API keys behind one shared 30 aggregate requests/minute
  budget with independent buckets disabled. Read the least-privilege Neon
  baseline twice to detect unexpected mutation; perform no persistent owner
  write and emit no raw API payload or identity.
- Upload only the sanitized recovery and first-backfill measurement evidence
  after post-run provider safety and unchanged-main checks. Retain the artifact
  for seven days and keep persistent Preview and Production prohibited.

## 2026-09-01 — First-backfill capture-interval authority

- Fix the finished-race history cutoff before acquisition, record a separate
  completion timestamp for each of the six source families and take the final
  measurement timestamp only after acquisition and cleanup complete.
- Require every family timestamp to fall inside that interval. Current-only
  endpoints cannot be relabelled as an instantaneous snapshot at the earlier
  history cutoff, especially when a complete historical crawl is long-running.

## 2026-09-01 — Bounded 150 rpm commissioning measurement retry

- Protected exact-main run `33476830763` passed prerequisites, all ten recovery
  cases, recovery cleanup, post-run provider safety and unchanged-main checks,
  but the complete inventory reached its fixed 9,000,000 ms test timeout while
  operating at the standing 30 aggregate requests/minute ceiling. It emitted no
  measurement artifact and performed no persistent owner-data write.
- Record the owner's explicit approval to retry this non-persistent commissioning
  measurement at no more than 150 aggregate requests/minute. This is one shared
  pool across all three keys; independent-bucket execution remains disabled.
- Keep 30 as the workflow default and require both an explicit `150` dispatch
  selection and its matching approval checkbox. A missing, mismatched or larger
  rate fails before API acquisition.
- This bounded acceleration does not change the website or daily-refresh policy,
  authorize persistent Preview data, enable paid capacity or alter Production.

## 2026-09-01 — Failed inventory acquisition requires sanitized diagnostics

- Protected exact-main run `33492115829` used the explicitly approved 150
  aggregate requests/minute ceiling. Provider prerequisites, all ten recovery
  cases, recovery cleanup, post-run provider safety and unchanged-main checks
  passed.
- The complete inventory failed after about 88 minutes before the first
  `finished_races` family completed. Cleanup was verified, the measurement
  artifact was skipped and no persistent owner-data write occurred.
- The previous generic catch erased the safe failure category and all bounded
  progress, making another long retry unauditable. Preserve fail-closed cleanup
  while emitting only an allowlisted family/failure code, aggregate request and
  rate-limit counts, plus count-only 500-request milestones.
- Never emit the provider exception message, request URL or window, entity ID,
  raw response, Vault reference, API key or other credential. These diagnostics
  do not constitute a complete inventory or P5 approval evidence.

## 2026-09-01 — Finished-race rows require typed stable-identity validation

- Protected exact-main run `33501119064` completed 13,311 finished-race API
  requests at the owner-approved 150 aggregate requests/minute ceiling before
  deterministic post-response validation failed. No request was rate limited.
- Provider prerequisites, all ten recovery cases, recovery cleanup, post-run
  provider safety and unchanged-main checks passed. The measurement artifact
  remained suppressed and no persistent owner-data write occurred.
- The successful-family and pool request counts were equal at failure, so the
  response had returned before an untyped finished-race row condition escaped
  as `unexpected_error`. Treat every row and `rid` as untrusted runtime data.
- Reject a non-object row, missing/non-string/non-numeric `rid`, empty `rid` or
  unsafe numeric `rid` with the allowlisted
  `finished_race_invalid_record` code. Do not emit the row, identifier, request
  window, provider message or payload and do not skip malformed source evidence.

## 2026-09-01 — Identity-conflicted finished rows remain measurable but non-approvable

- Protected exact-main run `33511615308` reproduced the source conflict after
  13,305 finished-race requests at the owner-approved temporary 150 aggregate
  requests/minute ceiling. It emitted
  `finished_race_invalid_record`, observed zero rate-limited requests, passed
  all ten recovery cases and provider-safety checks, left zero residue and
  withheld the incomplete artifact.
- A terminal non-persistent sizing crawl may now count each invalid leaf-row
  observation as a conservative unresolved identity upper bound. It does not
  create a DNA race ID, deduplicate or hydrate the row, log its payload or
  locator, or admit it to canonical analysis.
- Include that upper bound in record/storage/compact-Neon projections and emit
  it only through sanitized measurement evidence schema v2. Midpoint overlap
  may overcount an unidentified observation; undercounting is prohibited.
- Any non-zero unresolved identity bound sets `sourceAuthorityComplete=false`
  and the first-backfill packet to `blocked_source_authority`. Owner cost
  approval cannot override the blocker, and persistent Preview/Production
  writes remain prohibited.
- Before persistence can proceed, add a reviewed private immutable-evidence and
  quarantine boundary that retains the raw source observation under an
  internal evidence locator while explicitly preventing that locator from
  becoming a canonical DNA race identity or last-good publication fact.

## 2026-09-02 — Unresolved finished-race identity is privately preserved without publication

- Add an owner-scoped private R2 quarantine writer for non-saturated
  `races.finished` observations without authoritative stable `rid`.
- Derive its opaque internal evidence locator from the exact window, 1-based
  source ordinal and raw checksum. Do not place a raw value or invented race ID
  in the object key or metadata.
- Store and verify the immutable raw observation envelope with both
  `canonicalPublishable=false` and `lastGoodPublishable=false`. Exact retry
  reuses the same object; conflicting bytes or metadata fail closed.
- After quarantine, reject the whole window without race-document hydration,
  accepted-window manifest publication or checkpoint advancement. The R2
  publisher independently rejects malformed, duplicate or mismatched discovered
  and hydrated race identities.
- This completes the preservation boundary but does not resolve source
  authority. P5 remains `blocked_source_authority`; persistent real Preview
  acquisition still requires a source-authoritative resolution, complete
  measured cost packet and exact bounded owner approval.

## 2026-09-02 — Owner permits only bounded de minimis identity omission

- Do not request an upstream API change for a select few historical
  `races.finished` observations without stable `rid`; DNA is not expected to
  amend the API for an isolated row.
- Interpret “select few” conservatively as an aggregate complete-measurement
  upper bound of at most 25 observations. This is an omission ceiling, not a
  target and not an invented identity.
- Counts from 26 through 999 stop for owner review. A bound of 1,000 or more
  requires an explicit critical-volume notification and remains blocked.
- Keep every omitted observation private and immutable in quarantine, disclose
  the aggregate omission count in analytical completeness, and exclude it from
  canonical race/Core statistics. No raw payload or locator may enter logs,
  artifacts, issues or frontend output.
- This owner direction resolves the product decision only for a measured de
  minimis candidate. P5 remains closed until complete measurement, persistent
  omission enforcement, priced bounds and exact cost authorization all pass.

## 2026-09-02 — Complete measurement must retain a capacity blocker

- Exact-main protected run `33530224891` completed all six API inventory
  families and zero-residue cleanup at the owner-approved 150 aggregate
  requests/minute ceiling. Post-run provider safety and unchanged-main checks
  passed, but final measurement construction failed and no artifact was
  uploaded.
- Do not discard a complete non-persistent measurement merely because its
  compact-Neon peak is at or above the 536,870,912-byte limit. Emit the measured
  peak, the fixed limit and `neonCapacityWithinLimit=false` through sanitized
  evidence schema v4.
- Such evidence sets the approval packet to `blocked_capacity`. Owner cost
  authorization cannot override non-positive Neon headroom, enable paid
  capacity or permit any persistent Preview or Production write.

## 2026-09-02 — Malformed measurement envelopes receive bounded retries

- Exact-main protected run `33546889046` passed provider prerequisites, the
  ordered ten-case recovery suite, cleanup, post-run provider safety and the
  unchanged-main check at the owner-approved 150 aggregate requests/minute
  ceiling.
- The first `finished_races` family stopped after 8,396 total API attempts when
  attempt 8,396 returned a malformed response envelope. No request was rate
  limited, no artifact was uploaded, no persistent owner-data write occurred
  and cleanup left zero detected residue.
- A malformed envelope is not evidence of one malformed race row. Retry the
  exact read-only request at most twice after the first attempt through the
  same aggregate pool. Count all attempts in the API, Class A and Class B upper
  bounds and retain only aggregate diagnostics.
- A third malformed envelope remains a blocking acquisition failure. Never
  count it toward the owner-approved de minimis unidentified-row omission
  ceiling because the response did not establish a decoded race observation.

## 2026-09-02 — Persistently malformed finished-race windows subdivide

- A malformed `races.finished` envelope cannot be materialized with missing
  fields because it provides no decoded race identity, timestamp, entrants or
  result. One request can cover up to the endpoint's 200-row window limit, so it
  also cannot be treated as one omitted race.
- After the existing two same-window retries, subdivide only that failed time
  window and continue sequentially. Preserve midpoint overlap and stable-id
  deduplication so valid surrounding races remain complete.
- Bound malformed-window recovery to 64 subdivisions. A persistently unreadable
  minimum-width window or exhausted split allowance remains fail closed rather
  than inventing data or silently omitting an unknown population.

## 2026-09-02 — Historical backfill projection follows archive-first persistence

- Exact-main run `33562156694` completed all six inventory families, emitted
  sanitized evidence and left zero provider residue. It observed 1,134,850
  identified finished races plus one unresolved identity candidate and projected
  a $0.211814 one-time R2 upper bound at 150 aggregate requests/minute without
  rate limiting or persistent writes.
- Retain the policy-v1 5,778,740,666-byte Neon result as valid blocked evidence
  for that exact plan. Do not reinterpret or delete it.
- Correct the forward projection to match the implemented persistence boundary:
  complete historical response/race evidence remains private and immutable in
  R2; Neon retains bounded finished-window receipts/checkpoints, current-state
  generations and compact analytical/publication controls, not one relational
  row or raw body per historical race.
- Charge historical Neon at 24 KiB physical allowance per logical request plus
  2 MiB family overhead. Charge recurring current state at 16 KiB per source
  record, 8 KiB per logical request and 2 MiB per family. These bounds include
  indexes and candidate/last-good overlap and do not weaken R2 recovery.
- Require a fresh exact-main complete measurement under projection policy v2.
  Positive projected headroom still does not authorize persistent Preview data;
  the measured exact cost cap and owner approval remain mandatory.

## 2026-09-02 — Exact bounded P5 packet is ready for owner decision

- Exact-main protected run `33574168582` completed the ten-case recovery suite,
  all six non-persistent inventory families, cleanup and unchanged-main checks
  at the one-run 150 aggregate requests/minute ceiling. No rate failure,
  persistent owner-data write or provider residue occurred.
- Bind the sanitized evidence SHA-256
  `250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4`
  to 1,136,911 source records, 34,906 API requests, 1,151,071,826 retained
  private R2 bytes, 489,717,760 peak Neon bytes, 47,153,152 bytes of Neon
  headroom and a $0.212250 maximum projected one-time cost.
- The single unidentified finished-race observation remains non-canonical. Its
  raw evidence must be privately quarantined; only identified races may be
  hydrated or enter Core/race statistics; the quarantine receipt and cumulative
  omitted count advance atomically with the accepted window.
- Missing or changed measurement authority, missing/inconsistent R2 quarantine
  evidence or any cumulative count above one stops the backfill and preserves
  last-good serving.
- P5 is decision-ready, not write-authorized. The first persistent private
  Preview backfill requires explicit owner approval of the exact $0.212250
  maximum plus every documented stop and cleanup condition. Production remains
  prohibited.

## 2026-09-02 — Owner authorizes the first bounded persistent Preview backfill

- Record the owner's explicit written authorization for the first persistent
  private Preview DNA API backfill measured by run `33574168582`.
- Set the exact maximum authorized amount to $0.500000 (500,000 micro-USD),
  which covers but does not replace the measured $0.212250 conservative upper
  bound.
- Authorize quarantine and canonical/statistical omission of exactly one
  unidentified finished-race observation, bound to sanitized measurement
  evidence SHA-256
  `250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4`.
- Accept every documented stop and cleanup condition. Cost, capacity, provider
  budget, rate/eligibility/body authority, evidence/checkpoint/generation,
  authority drift, missing quarantine receipt or an omission count above one
  still stops the backfill and preserves last-good serving.
- This is one-time private Preview persistence authority only. It does not
  authorize Production, public access, paid capacity, recurring cost, wallet or
  game actions.
- P5 status is now `approved_for_first_private_preview_backfill`. Provider
  writes may begin only through a reviewed protected exact-main workflow that
  binds this authority before its first API request or provider write.

## 2026-09-02 — Commissioning persistence must match the measured request boundary

- Run `33574168582` priced one immutable private R2 object per logical API
  request. It did not price one object per finished race or a `races.docs`
  hydration request for each batch of discovered race IDs.
- Do not execute the legacy per-race hydration writer for the approved first
  backfill. At the measured population it would introduce more than a million
  Class A writes and tens of thousands of API requests outside the authorized
  $0.500000 ceiling.
- Persist each complete API request/response envelope once under an opaque
  owner- and measurement-scoped R2 key. Bind a global request ordinal, family,
  observation timestamp, checksum and byte count into the immutable receipt.
- Exact restart receipts may reuse an existing verified object without another
  PUT. Conflicting bytes, family/ordinal reuse, a non-private bucket, an object
  above 8 MiB, envelope overhead above 16 KiB, more than 17,453 logical objects
  or more than 1,151,071,826 retained bytes stops before further persistence.
- This aligns execution with the approved API/R2 cost model; it does not itself
  authorize a provider run. The protected exact-main workflow, durable receipt
  checkpoint and cleanup proof remain required before the first write.

## 2026-09-02 — First-backfill Neon ledger is exact and compact

- Persist the commissioning checkpoint as one owner-scoped run row plus one
  compact receipt row per measured logical API request; do not place raw API
  response bodies or per-race historical facts in Neon.
- Bind initialization to measurement evidence SHA-256
  `250984ef3371aa4f9b0b256b498b18083b1d1c2559de1882b8ee51c90dc30fe4`,
  the hashed written approval reference and the measured authority cutoff.
- Require global ordinal append order and compare-and-swap revision authority.
  Exact durable replay returns the current state without double-counting bytes;
  conflicting replay, gaps, authority drift or capacity overflow fails closed.
- Bind the sole unidentified finished-race omission to the same request receipt
  that locates its private immutable R2 evidence. Increment the receipt, byte
  and omission counters in one transaction; never create a canonical race ID.
- Permit completion only after exactly 17,453 request receipts cover all six
  measured source families and the bound omission count is exactly one. Keep
  direct runtime table privileges revoked and forced owner RLS enabled.
