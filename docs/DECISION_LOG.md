Warning: truncated output (original token count: 45191)
Total output lines: 2872

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
- At this point the initial-roster interpretation remained unresolved; the
  2026-09-15 owner authority below supersedes this historical state.
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
  physical/peak, private R2 cost a…25191 tokens truncated…e adding the
  bounded Preview operator command.

## 2026-09-09 — Preview refresh reconciliation is restart-conservative

- Expose the private daily operator only through an exact-main manual Preview
  workflow with a fixed UTC history upper bound, an explicit persistent-write
  arm and a maximum of 100 one-request steps.
- Obtain one fresh Cloudflare/Neon measurement and pass its cached evidence to
  the preflight before opening or reusing the matching durable billing window.
- Derive stable owner-scoped refresh, current-state and budget-window identities
  so a later workflow invocation resumes rather than forks the cycle.
- The concrete R2 meter is process-local while a cycle may span multiple
  short-lived runners. At final publication, therefore account the complete
  preflight-approved R2 reservation, not the final runner's partial reading.
  This deliberately overstates usage, preserves restart safety and can never
  increase free-tier authority.
- Emit only identifiers, step state and safety booleans. Do not log API bodies,
  provider measurements, credentials or owner payloads.

## 2026-09-10 — Unsupported recurring Race entrant IDs are quarantined

- Exact-main Preview commissioning isolated a Race document whose entrant-ID
  collection contains a runtime type outside the supported numeric contract.
- The owner explicitly authorizes affected races to be skipped or quarantined
  because missing this de minimis evidence is preferable to blocking the daily
  refresh.
- Preserve the Race and its private raw-evidence hash, omit the unsupported
  entrant IDs from canonical analytics and mark
  `entrantCoreIdsEvidenceStatus=unsupported_source_value`. Never coerce an
  unknown identifier representation, infer participation or treat absent
  participant evidence as favourable.
- Keep the limitation countable and visible in generation coverage. This
  authority applies only to unsupported entrant-ID evidence; identity,
  chronology, economics, publication consistency and owner isolation remain
  fail-closed.
- No raw value, owner identity, API response or credential may enter logs,
  artifacts or frontend output.
- The first resumed batch then exposed an unsupported Race results group. The
  owner confirmed that these affected races may miss data rather than block the
  refresh. Preserve the Race, quarantine the complete results field group with
  `resultsEvidenceStatus=unsupported_source_value`, and publish none of its
  track or star fields. This follow-up authority does not permit partial result
  inference or weaken the remaining fail-closed boundaries.
- Treat a present but non-text, blank or unknown Race mode as quarantined mode
  evidence under the same authority. Retain the Race with
  `modeEvidenceStatus=unsupported_source_value`, publish no canonical mode and
  never use it as Bike, Car or Horse evidence.
- Quarantine malformed fixed-fee evidence under the same omission authority.
  Retain the Race with `fixedFeesEvidenceStatus=unsupported_source_value`,
  publish no fee amounts and exclude the missing field from all financial
  analysis. Never infer zero or another amount.

## 2026-09-10 — Recurring current-state identity remains stable and UUID-safe

- Connected Preview commissioning completed finished-history collection and
  exposed the first transition into recurring current-state discovery.
- The command had derived that current-state root identity as a SHA-256 value,
  while the existing discovery, checkpoint and private R2 evidence boundaries
  require a UUID. The mismatch stopped before any current-state API request or
  evidence write.
- Derive one deterministic version-5 UUID from the same owner, fixed cutoff and
  domain-separated authority hash. Repeated short-lived runners therefore
  resume one current-state cycle without weakening the downstream UUID,
  owner-isolation or immutable-evidence contracts.
- Keep refresh and budget identities as their existing SHA-256 authorities.
  This compatibility fix authorizes no Production, paid-service, public-route
  or game action.

## 2026-09-10 — Completed history publication replays its completion time

- The first connected transition beyond completed finished-history collection
  exposed a safe replay conflict: a later short-lived runner supplied its new
  wall-clock time while re-confirming an already-published history cycle.
- Bind both validation and publication time to the cycle's immutable completion
  time. The original publication already used that same instant, because cycle
  completion and publication occurred inside one command step.
- A restarted runner can therefore replay the exact publication read-only and
  continue into current-state discovery. A completed cycle without its signed
  completion authority fails closed.
- This replay correction changes no receipt, baseline, owner, cutoff, budget,
  Production service, public route or game action.

## 2026-09-10 — Current-state retries keep the first evaluation instant

- Connected Preview reached current-state discovery and durably accepted its
  first request before a second short-lived step supplied a newer evaluation
  instant. The existing checkpoint correctly rejected that changed schedule.
- Treat the first discovery checkpoint's evaluation instant as the authority
  for the whole current-state cycle. Restarted discovery and scheduled
  acquisition reuse it while each API observation retains its real request
  time.
- The root is read through the existing owner-isolated checkpoint repository;
  missing, malformed or cross-owner state remains fail-closed.

## 2026-09-10 — Active-race discovery depends only on usable identity

- Connected current-state bootstrap evidence showed that an active-race row may
  omit a descriptor that the later full Race hydration boundary owns.
- Discovery now reads only the race identity needed to build that hydration
  request. Missing optional descriptors no longer discard an otherwise usable
  race; a row without a usable identity is omitted and counted under the
  owner's standing isolated-record quarantine authority.
- Raw current-state evidence remains immutable and private. No absent value is
  invented, and later Race hydration still validates every available field.

## 2026-09-10 — Missing active-race start time is retained as unknown

- Connected current-state publication evidence showed that `races.active` may
  omit `start_time` for an otherwise usable race.
- The active race is retained and its canonical start time remains `null`; the
  raw evidence hash is preserved and no timestamp is inferred.
- A malformed timestamp still fails closed. This is the narrow field-level
  quarantine authorised by the owner and does not weaken other race fields.

## 2026-09-10 — Missing active-race fixed fees are quarantined

- Connected current-state publication evidence showed that an otherwise usable
  active race may omit its fixed-fee breakdown.
- Retain the active race and its immutable raw evidence, but mark fixed-fee
  evidence unsupported and omit it from fee-dependent Pro League opportunities.
- Never infer an empty or zero fee. This is the owner's standing isolated-field
  quarantine authority and does not weaken validation of supplied fee values.

## 2026-09-10 — Incomplete active-race economics remain non-actionable

- Connected publication evidence next showed an active race without a usable
  USD entry fee. Treat absent or unsupported entry-fee and payment-asset values
  as unavailable evidence, using the same fixed-fee quarantine boundary.
- Retain the race and immutable raw evidence, but withhold it from fee-dependent
  Pro League opportunities unless every required fee field is authoritative.
- Never infer a zero fee or payment asset. Valid supplied values remain strict.

## 2026-09-10 — Unpaired current races are quarantined as whole records

- Connected publication evidence showed that active-race and race-fill results
  can have isolated identity gaps even when both requests complete successfully.
- Publish only the identity intersection: an active race without its matching
  fill, or a fill without its matching active race, is excluded from the current
  opportunity read model under the owner's approved race quarantine authority.
- Both immutable source responses remain in the private evidence index. No fill
  state is inferred, and the published pair counts remain internally consistent.

## 2026-09-10 — Missing optional Core appearance fields do not block publication

- Connected publication evidence showed an attached-assets record with no Bike
  skin value. Skin values are current cosmetic observations, not racing evidence.
- Retain the Core record, mark each omitted mode unavailable and treat an omitted
  trails value the same way. Never invent an attachment or replace missing data.
- Pro League readiness may continue with `bikeSkinAttached: false`; immutable raw
  evidence remains private and all supplied JSON values remain strictly checked.

## 2026-09-14 — Unsupported optional stamina event time is quarantined

- Connected Preview publication showed a Core stamina record whose optional
  last-event value was not a usable timezone-qualified timestamp.
- Retain the stamina observation, publish `lastEventAt` as unavailable and mark
  `lastEventEvidenceStatus=unsupported_source_value`; never invent or repair a
  time from an ambiguous provider value.
- Current and maximum stamina plus next-refill time remain strictly validated.
  The private raw evidence hash remains available for audit, while this optional
  operational timestamp does not block a complete generation.

## 2026-09-14 — Splice Arena family totals count listings, not pages

- Connected Preview publication reached its complete Splice Arena materializer
  and exposed that the candidate family total had been derived from page count.
- Bind the family `itemCount` to the sum of canonical listings across every
  complete, contiguous terminal page. Page count remains independently checked
  by the page materialization and cannot substitute for listing completeness.
- This is a counting correction only: no Arena listing is skipped, invented or
  deduplicated, and the atomic publication boundary remains fail-closed.

## 2026-09-15 — Persist quarantined active-race economics without invention

- Connected Preview publication proved that the canonical adapter correctly
  quarantines unavailable fixed-fee, entry-fee or payment-asset values, while
  the original database contract still required all three values to exist.
- Align the database validator with the adapter's exclusive value-or-explicit-
  quarantine contract. Unsupported values remain absent and are never stored as
  zero, an empty asset or another invented replacement.
- Exact canonical keys, non-negative available values, known evidence statuses,
  owner isolation and atomic publication remain fail-closed.

## 2026-09-15 — Initial Pro League roster uses zero substitutions

- Owner authority confirms that initial roster registration consumes zero
  substitutions. Only roster changes made after initial registration count
  toward the maximum 10 substitutions per year.
- Keep the interpretation explicit in every roster version. Historical versions
  may retain their earlier authority state without changing the current rule.
- Current later-change usage and remaining allowance stay unavailable until the
  annual substitution ledger is connected; never infer either value.
- This is advisory configuration only. No roster submission, substitution or
  other game action occurred.

## 2026-09-15 — Pin owned Cores to the complete daily generation

- Pro League roster commissioning must read owned Core metadata from the same
  complete daily generation as current races, supplemental Core state and sync
  health. The independently advancing current-state pointer is not sufficient.
- Add an owner-isolated combined owned-Core read and include it in the shared
  one-transaction serving bundle. Reject mixed generation identities rather
  than combining newer Core metadata with an older accepted history package.
- This read path remains private and read-only. It does not rank Cores, publish
  a roster or map, deploy a website, or perform a game action.

## 2026-09-15 — Expose structural roster inputs without selecting Cores

- When the complete daily generation exists before the exact-format Pro League
  evidence generation, show only owner-scoped Core names and roster-rule totals
  from that accepted daily generation.
- Do not rank, select or map a Core from metadata or broad distance statistics.
  Keep the roster and all 168 map assignments held until exact Bike race type,
  exact distance and elapsed-time evidence is connected and verified.
- Hide the older broad-performance preparation list in this structural-only
  state so it cannot be mistaken for a current recommendation. The page remains
  private, read-only and unable to perform a game action.

## 2026-09-15 — Pin the complete incremental history lineage to daily serving

- Exact-format Pro League evidence must use the finished-history cycle selected
  by the same complete daily generation as owner Cores and current state.
- Read that selected cycle and every immutable predecessor receipt in one
  owner-scoped transaction. Do not follow an independently newer history pointer
  or mix a partial refresh into the serving package.
- Recalculate every cycle's receipt count, document count, byte total, checksum
  and contiguous bounds before exposing its private R2 locators to server-side
  analysis. Raw evidence and identifiers remain off the frontend.

## 2026-09-15 — Per-Core API history restores exact performance fields

- The earlier v1 race-document conclusion was too narrow: it assessed race
  metadata but omitted the separate per-Core result-history family.
- A fresh read-only scan covered all 214 Cores then reported by the owner Vault.
  Their first result pages returned 10,383 rows; 10,374 rows contained positive
  `cb`, `time` and `pos` values. No Core request failed or returned empty.
- For 200 sampled race identities, v1 returned all 200 race documents. Across
  225 owner-Core result rows in those races, race identity and entrant Core
  identity both joined, and all 225 comparable `cb` values matched exactly.
- `cb` is therefore the provider distance code already normalized by the
  historical result adapter (`9` to `23` in this scan means 900m to 2300m),
  `time` is elapsed seconds and `pos` is finishing position. Core racing-stats
  remains aggregate current state and contains no sampled race identity.
- Keep recommendations held until this result family has durable incremental
  checkpoints, immutable raw evidence, owner isolation, replay-safe
  deduplication and complete-generation publication. The scan itself retained
  no payload or identifier and performed no provider or Production write.

## 2026-09-15 — Bound per-Core result transport and canonical evidence

- Keep the separately observed per-Core history endpoint outside the Open Lab
  v1 bearer client. It sends no credential, makes one explicit Core/page POST,
  retains future source fields and exposes rate-limit/Retry-After metadata to
  the shared conservative request pool.
- Treat response-body error status and HTTP 429 as authoritative, replace
  provider/transport detail with content-free errors and reject malformed
  envelopes or non-record result rows before adaptation.
- Accept analytical evidence only when requested and returned Core identities
  match and race ID, mode, positive distance code, elapsed seconds and finish
  position validate. Normalize the established sub-100 `cb` code to metres;
  preserve already-normalized metre values and the raw-evidence checksum.
- Quarantine incomplete or cross-Core rows by fixed diagnostic plus checksum.
  Exact duplicate identities are replay-safe; a changed payload under the same
  Core/mode/race identity holds the page as a conflict.
- This boundary does not yet persist or publish the history family, lift the
  Pro League recommendation hold, call the live API, deploy a site or perform a
  game action. Durable pagination checkpoints, private R2 receipts and combined
  generation publication remain the next dependency.

## 2026-09-15 — Close Core history only on an explicit empty page

- A bounded, read-only, redacted provider run found the observed result-history
  page cap at 50 rows and found a non-empty short page while scanning 186 of
  the 214 then-current owned Cores.
- Replaying the full page and the first empty page produced stable content; the
  following page also remained empty. Treat an explicit empty page as terminal.
  A short non-empty page must advance to and retain its next page rather than
  being guessed complete.
- The probe used the standing 30-request-per-minute aggregate policy, retained
  no provider payload or owner identity and made no persistent write.

## 2026-09-15 — Version owner-scoped Core result acquisition attempts

- Bind every result-history cycle to one published current-state generation,
  its exact sorted owned-Core set and the immediately prior completed result
  cycle. Give each Core its own monotonic page cursor and receipt chain.
- Store the first page observation under a private create-if-absent R2 key
  derived from opaque owner/Core hashes. Store invalid-row diagnostics in a
  separate immutable quarantine object; a changed duplicate result identity
  holds progress rather than choosing a value.
- Advance the immutable page receipt and compact Core checkpoint atomically in
  Neon under forced owner RLS and function-only runtime access. Exact replay is
  idempotent, pauses retain progress, terminal attempts cannot change and a
  deliberate replacement starts fresh checkpoints without deleting the
  superseded attempt or its private evidence.
- Completing acquisition requires every Core's explicit empty terminal receipt
  and exact aggregate totals. It does not publish analytical rows, lift the Pro
  League hold, authorize a connected persistent run or change Preview or
  Production. Cross-page/cross-cycle deduplication, result/race joining and
  combined-generation publication remain next.

## 2026-09-15 — Gate each Core-result page before provider or R2 work

- Advance at most one Core-history provider page per runner invocation through
  the shared request budget, whose effective ceiling must remain at or below 30
  aggregate requests per minute.
- Require an explicit pre-reserved upper bound before any evidence read or API
  call. One step allows at most 16 MiB retained storage, two R2 Class A
  operations and seven Class B operations, covering the maximum page and
  quarantine create-if-absent verification path.
- Require the returned authority to echo the exact page request checksum,
  forbid paid use and preserve last-good publication. Derive the 16-MiB ceiling
  from two separately enforced 8-MiB object bounds, and reject a provider
  success page above the verified 50-row limit as malformed.
- Recover and verify immutable page evidence before repeating a provider call.
  Persist the compact Core cursor only after the receipt is valid; completing
  the final Core also closes the cycle with all checkpoint totals.
- Pause without cursor movement when the budget closes, the provider is
  unavailable, rate-limited or malformed, or immutable evidence conflicts.
  Honor `Retry-After`, falling back to the provider reset window when needed.
- This is a pure composition boundary. It does not yet wire the connected
  Preview command, collect a real result page, publish analytical results,
  deploy a site or perform a game action.

## 2026-09-15 — Join Core result history through exact race authority

- Preserve normalized race-document `cb` distance as a second source and
  require it to match the per-Core result distance before analytics can use the
  row.
- Deduplicate exact result replays across pages and cycles by stable Core/mode/
  race identity. A changed result or race document under one identity blocks
  the entire materialization candidate.
- Require owner Core membership plus a race-document join by race ID, entrant
  Core ID, mode, distance, gate count and event time. Reject impossible finish
  positions and elapsed seconds that cannot be represented exactly as integer
  milliseconds.
- Derive a map race type only from supported payout, gate and published-distance
  authority. Retain missing, unsupported and unpublished formats as explicit
  non-published counts. No durable result publication or recommendation is
  authorized by this pure boundary.

## 2026-09-15 — Stage joined Core results before atomic publication

- Bind each joined-result candidate to the exact completed-cycle set, ordered
  observation set, reconciled coverage counts and a content-derived payload
  digest. Recompute the observation identity before any repository access.
- Stage deterministic rows in batches of at most 250 and require the repository
  to echo every ordinal and row checksum. Exact replay resumes staged work;
  changed content or a drifted response fails closed.
- Ask to publish only the complete expected row count and payload digest. An
  interrupted or rejected stage/publication cannot replace the prior last-good
  generation, and an already-published replay must load the exact metadata.
- This provider-neutral contract performs no API request, R2 read, database
  change, deployment or game action. Forced-owner Neon persistence and its
  reversible migration remain the next dependency.

## 2026-09-15 — Persist joined Core results behind one last-good pointer

- Store generation metadata, deterministic joined rows and the active pointer
  in separate owner-scoped relations with forced row-level security. The
  runtime has no direct table privileges and may use only the reviewed begin,
  stage, publish and read functions.
- Stage at most 250 consecutive rows per call. Exact replay is idempotent;
  changed content, ownership drift, worker drift or publication of an incomplete
  row set fails closed.
- Recompute the complete ordered row digest and contiguous ordinal coverage from
  stored rows before publication. Move the owner-local active pointer in that
  same transaction only when count, digest and monotonic materialization agree.
  Interrupted or rejected work cannot replace the prior last-good generation.
- Migration `0101` is reversible and smoke-tests function-only privileges,
  replay, incomplete-publication rejection and owner isolation. It does not run
  collection, store private data, deploy a site or authorize a game action.

## 2026-09-15 — Bind retained Core-result pages to exact receipt authority

- Return each canonical retained materialization page together with the exact
  receipt reconstructed from its private immutable page and quarantine objects.
- Before race-document hydration, replay every ordered receipt from a fresh
  per-Core checkpoint. Require the resulting full checkpoint, including receipt
  chain and completion identities, to equal durable authority, then recompute
  and compare the complete cycle identity. Equal aggregate counts alone are not
  publication authority.
- Hold every successor cycle with `historical_lineage_required` before
  checkpoint, R2, hydration or publication work until the full completed-cycle
  chain can be composed. This prevents a changed current-owner Core set from
  silently deleting earlier historical evidence or replacing last-good with a
  truncated generation.
- The root-cycle path remains available for the first bounded private
  commissioning generation. This change performs no live collection, private
  evidence write, deployment, provider change, cost or game action.

## 2026-09-15 — Compose bounded Core-result collection and publication

- Advance at most one owner-scoped Core-history page per operator call. Return
  partial, paused or held collection without reading retained generation
  evidence or staging analytical rows.
- After complete acquisition, require the current durable free-budget window.
  Accept only an exact reserved or already-accounted decision that explicitly
  forbids paid use and preserves last-good, then account the full approved
  Class B ceiling before the first retained read. Verify the accounting receipt
  echoes the exact window, reservation, request identity and usage.
- Route all race-document hydration through the same conservative aggregate
  request budget. Sub-batch the materializer's at-most-25-ID handoff through the
  connected v1 client's at-most-20-ID boundary and require exact response
  coverage before joined publication.
- This operator has no environment-derived credentials or deployment surface
  and performs no work until explicitly invoked. Exact-main Preview command
  gating, connected execution and the first complete private generation remain
  later commissioning steps.

## 2026-09-16 — Count and omit results lacking quarantined entrant authority

- Exact-main Preview publication reached a retained Race document whose entrant
  collection was already classified as `unsupported_source_value` under the
  owner-approved 10 September quarantine boundary.
- Do not infer that a per-Core result proves participation when the corresponding
  Race entrant authority is malformed. Omit that result from canonical
  analytics while preserving its accepted immutable source evidence and Race
  document hash.
- Record each affected result as an explicit entrant-authority omission in the
  generation metadata. Reconcile input results exactly as published
  observations plus exact replay duplicates plus these omissions.
- A Race document that merely lacks entrant evidence, identifies a different
  entrant, or conflicts under one stable identity still blocks publication.
  Migration `0102` adds the owner-isolated count and a versioned begin function;
  it does not alter existing published rows, deploy the website or touch
  Production.

## 2026-09-16 — Quarantine contradictory entrant joins

- Exact-main Preview publication then encountered a retained per-Core result
  whose otherwise valid Race entrant collection did not list that Core.
- Neither source is sufficient to override the other. Preserve both immutable
  source records, do not infer participation, and omit only the contradictory
  result from canonical analytics.
- Count these omissions separately from malformed entrant-authority omissions,
  and reconcile every input result as a published observation, exact replay
  duplicate, unavailable-authority omission or contradictory-entrant omission.
- Missing entrant evidence still blocks publication. This fail-closed
  quarantine does not alter raw evidence, deploy a site, touch Production or
  authorize any game action.

## 2026-09-16 — Bound downstream analytics to the active Core history generation

- The commissioned Preview publication now has one complete active generation;
  partial or staging generations remain invisible.
- Add owner-scoped function-only reads for the active generation metadata and
  at most 250 ordered rows per call. Continuation uses the last accepted
  ordinal, so retries are stable and bounded.
- Keep direct table access denied. This boundary exposes canonical analytical
  observations, not raw API responses, and is the required source for the next
  Pro League evidence generation.

## 2026-09-16 — Verify active API history before exact-format analysis

- Read active generation metadata and bounded rows only through the owner-scoped
  function boundary, inside repeatable-read, read-only transactions. Reject a
  privileged runtime role or direct table access.
- Verify each canonical row hash, generation identity, contiguous ordinal and
  strictly increasing natural key. Recompute the complete ordered generation
  digest and re-read the active pointer after the final page so incomplete,
  changed or mixed generations cannot feed Pro League evidence.
- Give exact-format analytics a source-neutral race-fact contract. The API
  adapter projects only authoritative Core, race time, mode, exact distance,
  gates, finish, event time and payout-format facts; it does not manufacture
  legacy CSV dataset, import-batch, partition or row identities.

## 2026-09-16 — Bind Pro League evidence to one immutable API generation

- Preserve existing Race Merge evidence generations while adding an explicit,
  mutually exclusive Core-history API source identity for new generations.
- Begin API-derived evidence only when the named complete Core-history
  generation is still active and its observation digest, materialization time
  and classification counts agree exactly with the reducer input.
- Recheck the same source immediately before publication. A changed active
  pointer, altered count, wrong source kind, cross-owner call, incomplete row
  family or digest mismatch keeps the prior last-good evidence active.
- Reversal removes only re-derivable API evidence and restores the newest
  remaining published legacy generation per owner. Raw Core-history evidence is
  never modified. This migration does not deploy the website or touch
  Production.

# 2026-09-16 — Active API generation is the commissioned Pro League evidence source

- Apply migration `0105` only to the private Preview branch after its complete
  apply/smoke/reverse/removal proof is exact-green on the merged head.
- Build exact-format benchmarks and Core profiles only from the active complete
  Core-history generation through owner-scoped function-only reads.
- Bind the compact evidence receipt to that immutable source generation,
  observation-set digest and materialization cutoff; do not fabricate legacy
  CSV identities or combine the two source kinds.
- Use checksum-verified ephemeral runner-local spill files for this bounded
  commissioning run. Remove them after every outcome and make no DNA API or R2
  request while deriving the compact evidence.
- Publish only after exact source coverage, row ordinals, family counts and the
  complete two-family digest reconcile. Keep the previous last-good pointer on
  any source drift, failure or incomplete run.

## 2026-09-22 — Renew capacity authority during long Preview refresh runs

- The corrected complete-Arena Preview refresh advanced 14 durable steps, then
  stopped after five minutes because its single cached read-only provider
  measurement had reached the existing freshness limit. This was an authority
  expiry, not proof that free provider capacity was exhausted.
- Before starting a later bounded step after that expiry, obtain a fresh
  Cloudflare/Neon measurement, rerun the same conservative monthly projection
  and rebuild the connected operator from that authority. Continue only when
  the billing window is unchanged and the renewed projection is ready.
- A changed billing window, failed measurement or closed projection remains a
  content-free hold with the last-good generation preserved. The aggregate DNA
  request ceiling remains 30 per minute, reserved R2 accounting remains
  conservative, and no paid use, Production change or game action is allowed.

## 2026-09-22 — Return resumable progress before the hosted test ceiling

- A 100-step Preview continuation kept making durable progress but reached the
  connected test's 15-minute ceiling before it could emit its content-free
  receipt, so GitHub reported a failure despite the restart-safe checkpoints.
- Bound the command itself to twelve minutes and check that elapsed-time limit
  before every next request. A reached runtime bound returns an `advanced`
  receipt and preserves the checkpoint for the next exact-main continuation.
- Keep the independent step bound, provider-capacity renewal, 30-request/minute
  ceiling, last-good publication boundary and zero-cost safeguards unchanged.

## 2026-09-24 — Reconcile Core history incrementally from the active generation

- Keep the complete active 203-Core history generation as the durable
  analytical authority. Do not replace it with the temporary Round 2 local
  cache or schedule another lifetime pull for every currently owned Core.
- Derive one deterministic owner-scoped refresh plan from current ownership,
  the prior completed acquisition and the active generation. Only newly owned
  Cores may enter a full-history work set; previously covered Cores require a
  separately proved bounded delta strategy.
- Keep no-longer-owned Cores explicit in historical lineage so ownership
  changes cannot erase accepted observations. Missing or inconsistent prior
  cycle/generation authority fails closed before provider or persistence work.
- The planner is a pure boundary: it calls no provider, writes no private data,
  publishes no generation, deploys nothing and authorizes no game action.
  Successor lineage composition and the bounded existing-Core delta proof
  remain required before connected refresh resumes.

## 2026-09-24 — Run finished-race history near-live; keep non-race state daily

- After the current population reconciliation/backfill publishes a complete
  last-good generation, target one incremental `races.finished` poll every
  minute. This is a freshness target, not permission to exceed provider or
  zero-cost limits.
- Keep one durable race cycle at a time. A later scheduler tick resumes an
  unfinished cycle rather than creating overlapping work. Every new cycle starts
  from the latest complete finished-race checkpoint and retrieves only
  missing/new evidence.
- Hydrate only newly observed Race documents and schedule only the entrant-Core
  performance deltas required to keep elapsed time, exact distance and finish
  position current across Bike, Car and Horse. Persist validated enrichment for
  reuse instead of repeating lifetime history.
- Keep Arena, current Core supplemental state, Vault/ownership and Token prices
  on the independent 24-hour current-state cadence. Pair info/validation remains
  on-demand. A minute race tick cannot make the daily families due.
- Preserve the <=30 aggregate DNA requests/minute ceiling, Retry-After handling,
  last-good publication, zero-paid-use policy and R2/Neon fail-closed capacity
  guards. Any blocker delays the target cadence without destructive restart.
- Host the eventual minute trigger separately from the daily current-state
  schedule. Prove it first in protected private Preview after reconciliation
  completes. Production activation remains a separate owner-gated action.

## 2026-09-24 — Relieve population-index staging storage without weakening authority

- Connected capacity evidence identified Neon storage, rather than R2 storage or
  compute, as the active population-reconciliation blocker. The staging race
  table's broad mode index has no runtime reader and duplicates the
  owner/generation/race identity already retained by its primary key.
- Migration `0113` removes only that unused secondary index. It does not delete
  a race, canonical value, receipt, checkpoint or active pointer; reversal
  restores the exact index definition. The protected Preview command applies
  and smokes the migration before capacity is remeasured or another slice runs.
- Treat the recovered space as bounded commissioning headroom, not the final
  solution. The complete durable shape remains private R2 canonical/index
  chunks with compact owner-scoped Neon manifests, checkpoints, aggregates and
  publication pointers. Paid use remains disabled and Production unchanged.

## 2026-09-24 — Make the verified R2 cutover storage-negative per chunk

- A whole-generation cutover still required Neon to retain every legacy race
  while building the complete R2 manifest set, so the free-storage guard held
  before the first chunk. Migration `0115` makes each manifest insertion and
  retirement of its exact source-ID range one database transaction.
- The existing registration function first proves every source identity and
  evidence hash against the legacy authority. An `AFTER INSERT` trigger then
  deletes exactly the registered ordered range and rejects the transaction
  unless the deleted count equals the immutable R2 receipt count. A failed R2
  write never reaches Neon; a failed proof rolls back both manifest and delete;
  replay of the deterministic R2 object remains idempotent.
- Finalization now requires zero legacy rows, exact manifest/checkpoint totals,
  contiguous ordinals and non-overlapping ranges. Only an otherwise-clean
  preflight blocked solely by Neon storage may run this storage-negative relief
  operation. R2, compute, measurement and billing guards remain fail-closed;
  paid use remains disabled and Production is unchanged.

## 2026-10-03 — Bind the first population Core-history slice to readiness

- Reconstruct the exact deterministic Core slice used by the read-only
  population measurement so a later persistent command cannot substitute the
  owner-serving Core set or select a fresh population after readiness.
- Permit first-cohort authority only for one completely measured Core whose
  acquisition, selected-set and measurement-slice identities still match the
  current quarantine-tolerant population plan. Plan drift, incomplete
  measurement, more than 30 aggregate requests/minute, or any write/paid-use
  signal fails closed.
- Keep this boundary pure and non-executing. It returns no provider or
  persistent-write permission, requires a fresh capacity preflight, preserves
  partial-universe disclosure for quarantined Races, and changes neither
  Preview nor Production data.

## 2026-10-03 — Separate first-cohort collection from publication

- Execute the authorized population Core-history proof, when separately armed,
  as one exact-main, single-Core acquisition cycle linked to the existing
  complete history lineage. Stop at collection completion; do not reuse the
  owner-serving command path that can also publish a generation.
- Bind the command to every readiness digest, require a fresh A$0 provider
  capacity receipt before collection, retain the 30 aggregate request/minute
  Core-history limit and recheck receipt expiry before every step.
- Verify the stored lineage independently: the predecessor union must match the
  readiness authority, the delta must contain only the selected Core, and the
  before/after counts and digests must be reproducible. Duplicate population
  coverage, publication, paid use or last-good drift fails closed.

## 2026-10-03 — Connect the population proof only to private collection ports

- Adapt the first population Core-history command to the owner-scoped Preview
  acquisition repository, private R2 evidence store and durable zero-cost R2
  budget without accepting a Core identity from environment configuration.
- Track the exact fresh provider measurement used by the command preflight and
  open only its fail-closed budget window before the first collection step.
  A held A$0 decision opens no window and performs no collection.
- Present the selected singleton as an isolated acquisition generation and keep
  the existing 30 aggregate request/minute Core-history budget. This adapter
  does not add a workflow, dispatch authority, publication path or connected
  write by itself.
- Derive the acquisition generation UUID deterministically from the bound
  measurement-slice digest so the existing UUID-validated lineage repository
  accepts the population authority without weakening its identity contract.
- Keep the first population Core-history persistent cohort dormant behind a
  dedicated exact-main, owner-relayed, private-Preview workflow. The workflow
  reconstructs fresh read-only readiness and A$0 capacity, persists only the
  deterministic singleton, independently rereads and verifies its durable
  lineage, and has no schedule, publication or Production path. Adding this
  boundary does not authorize or dispatch the cohort.
