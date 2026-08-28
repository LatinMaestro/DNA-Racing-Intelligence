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
