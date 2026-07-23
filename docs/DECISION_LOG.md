# Decision Log

## 2026-07-21 — Product and delivery

- Product is private and for one user only.
- Development is online-only through GitHub/Codex and hosted services.
- Balanced objective: tournament success, financial performance where relevant, elite discovery, breeding value and overall vault improvement.
- Tournament rules must be configurable because qualification formats vary.
- Qualification is the main controllable stage; later rounds and finals are auto-run.
- Race, vault, core and arena data are periodically imported snapshots rather than live game feeds.

## 2026-07-21 — Performance modelling

- Bike, car and horse are separate.
- Primary evidence is race time and speed by exact distance.
- Lower elapsed time is better; higher speed is better.
- Finishing positions are secondary during discovery and can gain weight in paid qualification contexts.
- Do not initially assume payout or tournament format changes intrinsic performance.
- Ignore legacy race class.
- Ten exact-distance races is the minimum minimally analytical sample.
- Do not calculate remaining lifetime races.

## 2026-07-21 — Gold and Blue star signals

- Use the game and CSV terminology **Gold star** and **Blue star**.
- Race Merge `gold_star` means the game assessed that core as having the strongest chance to finish in the top three in the entered field.
- Race Merge `blue_star` means the game assessed that core as having the strongest chance to win and finish first in the entered field.
- Gold stars are not assigned in races with three gates or fewer.
- Derive Gold eligibility from gate count greater than three.
- A 1-, 2- or 3-gate race must not count as negative Gold-star evidence or enter a Gold assignment-opportunity denominator.
- Any source Gold assignment at three gates or fewer is retained and flagged as an anomaly.
- Stars are pre-race and field-relative, not guaranteed outcomes or absolute core ratings.
- Preserve raw source values and normalized nullable Gold/Blue fields in the database.
- Distinguish `false` from missing, partial, invalid and Gold-ineligible states.
- A star over historically strong cores is positive supporting evidence.
- Repeated failure to receive an available star against historically weak cores is negative supporting evidence, but no-star evidence alone cannot stop Discovery, classify a core as poor or recommend burning.
- Race time and speed remain primary; star evidence supports whole-core analysis, Discovery, tournament and Maiden suitability, breeding research and lifecycle advice.
- Historical field quality must be calculated from information available before the event. Current-event outcomes and future races must not leak into the assessment.
- Track all-race, Gold-eligible and assignment-opportunity denominators separately.
- Detect changes in star assignment and predictive performance over time because the hidden game algorithm may change.
- Test whether parent and lineage star profiles add predictive breeding lift; do not assume star propensity is inherited.

## 2026-07-21 — Open Race star timing

- Current-race Gold and Blue stars are not visible while cores are entering and the user is deciding which core to use.
- Stars are revealed only after all race gates have been filled and the race is set to take place.
- At star reveal, the user’s entry decision is already committed and the race is about to run.
- The Open Race selection recommendation must not request or depend on current-race stars.
- Historical imported Gold/Blue profiles may still support the pre-entry recommendation.
- Optional manual star capture after field lock is observation-only and must not trigger a replacement-core recommendation.
- A post-lock observation is not a race result or a pre-entry advantage.
- Optional manual observations must remain separate from permanent historical aggregates until reconciled with the later Race Merge event.
- Reconciliation must avoid duplicate star counts and surface mismatches.
- Gold remains not applicable in locked 1-, 2- or 3-gate races.

## 2026-07-21 — Data freshness

- A newer race export is expected approximately once every few days.
- The website will not operate from live race data.
- Store and show both `Data current through` using the latest accepted event timestamp and `Last imported` using import time.
- Calculate and display data age and a current/ageing/stale state.
- Imported race, vault, core and arena information must be described as historical or latest-import snapshots, not live.
- Do not infer that events after the latest accepted event timestamp did not occur.
- New cumulative imports must update data and aggregates idempotently.

## 2026-07-21 — Discovery

- Discovery is lineage-informed, not random.
- Historical evidence priority: own results, parents, grandparents, full siblings, half siblings, offspring, wider lineage, broad population patterns.
- Permit controlled probes for unexpected elite outliers.
- Stop weak paths early.
- Early stars over strong fields may justify continuing a targeted probe before the 10-race sample is reached.

## 2026-07-21 — Maiden

- Genesis may be ME if newly minted; all new bred cores begin ME.
- Any qualification participation commits ME to that Maiden.
- ME remains visible until the event concludes, then is removed.
- Non-participation preserves ME.
- Wait for the strongest projected Bike, Car or Horse Maiden rather than using the first available event.
- A core may be entered primarily for one of several shared brackets.
- Star evidence can support a limited-sample ME decision but cannot override materially weak time evidence.
- Maiden recommendations must disclose the imported race-data cutoff.

## 2026-07-21 — Tournament entry

- User may try to qualify many cores.
- Vault occupancy is capped at 50% of gates but should not be targeted.
- User manages live occupancy and prefers outside entries to reduce loss risk.
- Auto-Entry recommendations identify candidates, initial repetitions and stop/continue rules.
- Historical stars are supporting evidence; the configured leaderboard metric remains the primary tournament objective.
- Imported data cannot represent the current live qualifying field.

## 2026-07-21 — Breeding

- Hidden qualities are probabilistic and rare exceptional “supernatural” outcomes exist.
- Analyse whether historical data provides predictive breeding lift without claiming certainty.
- Latest imported arena data is the source for external availability and must show freshness.
- Assume all active owned cores are available unless marked otherwise.
- Breeding recommendations have separate elite-upside, vault-gap and balanced rankings.
- Existing saturation must not suppress a genuinely high-upside pairing.
- Offspring class uses the confirmed class matrix.
- Offspring element is the lower-ranked parent element.
- Offspring F-number is the parent sum with no cap.
- Pair cost uses the higher DNA base fee plus external nominated fees only.

## 2026-07-21 — Burn

- Genesis cannot be burned.
- Spliced cores can be burned permanently.
- Historical lineage remains.
- Burn-credit value is not predicted by the lifecycle model.
- Recommendations focus on overall vault quality.
- The actual BGC returned after a burn may be manually recorded in Vault Performance.
- Absence of an available star is never sufficient by itself to recommend burning.

## 2026-07-21 — Vault Performance and accounting

- Add a private Vault Performance area for normal open racing, tournament qualification, automated rounds/finals, breeding income/expenses, core sales/purchases and burns.
- Use Race Merge exports to derive entry fees and race payouts where source semantics are validated.
- Support manual game-owner tournament payouts sent directly to crypto wallets because these may not appear in race results.
- Tournament campaign reporting must combine qualification fees/payouts, automatic-stage payouts and manual external prizes without double counting.
- Support manual transaction entry, correction, reversal, reconciliation and source provenance.
- Arena listings do not prove that a breeding transaction occurred; actual breeding fees earned or paid require an authoritative transaction source or manual entry.
- BGC is a separate non-cash in-game credit. Track BGC earned, spent and net movement separately from cash/crypto P/L.
- BGC can be used for arena fees. Burn returns may be recorded as BGC after the actual amount is known.
- Do not silently convert BGC or unlike currencies/assets.
- Exclude deposits, withdrawals and internal transfers from operating P/L.
- Core sale profit requires known cost basis; otherwise show proceeds and a missing-cost-basis warning.
- Do not include estimated unsold-core value in realised P/L by default.
- Every performance report must state coverage, unclassified activity, data cutoff and whether it is complete, partial or estimated.
- Never request or store wallet private keys, seed phrases or signing credentials.

## 2026-07-22 — Phase 0 architecture accepted

- Use Next.js App Router with strict TypeScript and an accessible responsive private dashboard shell.
- Use Clerk authentication plus a server-side authorised-user ID allowlist for the single owner; missing configuration must fail closed.
- Use Neon PostgreSQL for application state, manifests, durable aggregates, reconciliation and the exact-value economic ledger.
- Use private Cloudflare R2 Standard storage for raw uploads and partitioned analytical data; never expose a public bucket or commit source data.
- Use an ephemeral hosted Python worker with Polars/DuckDB for import and aggregate processing; routine requests read precomputed aggregates rather than scan full race history.
- Treat the historical Bike-labelled details export and its \`bikeid\` field as legacy source aliases for cross-mode Core Details and normalized \`core_id\`.
- Detect and record legacy encodings and Boolean casing variation rather than assuming all exports are canonical UTF-8.
- Treat source IDs as authoritative. Name-only vault/core matches are proposed for review when ambiguous or unmatched.
- Keep Production disabled through both build-time and runtime controls. Preview access is disabled until explicitly enabled behind deployment protection.
- Expected Phase 0 cost is US$0. Any paid service, recurring infrastructure or Production activation remains review-gated.
- Gate A is accepted on the verified Phase 0 evidence. Phase 1 may proceed while full private-data hosting remains separately gated at Gate B.

## 2026-07-22 — Autonomous delivery authority

- The repository owner grants standing authority for the implementation agent to self-review, push, mark ready and merge focused pull requests when they match the repository source of truth, all applicable validation and CI pass on the exact head, the complete diff is reviewed and no client-only stop condition applies.
- Gates A–E remain mandatory evidence and quality gates. The agent may document and self-accept them when the required evidence is complete instead of waiting for a redundant routine owner review.
- Gate F remains client-only. Production activation, a custom domain, public routes, full private-data upload to Production and recurring paid infrastructure still require explicit owner approval.
- The agent must continue through the phased build plan, prefer narrow testable pull requests and verify merged `main` before starting the next dependent slice.
- Client action is required only for account access, secrets, private-data upload, paid services, irreversible Production changes, material architecture or privacy departures, confirmed-rule changes or ambiguity that would materially alter a recommendation or financial total.

## 2026-07-22 — Phase 1 data-foundation schema

- Use reversible direct PostgreSQL migrations for the initial data foundation without applying them to a persistent hosted database.
- Keep all private relational records owner-scoped and protected by fail-closed row-level security; application-role grants and Preview credentials remain a later account-action boundary.
- Keep batch coverage, active-dataset current-through time, import completion and aggregate refresh as separate timestamps.
- Use stable source IDs and batch provenance; ambiguous name matches remain reviewable.
- Derive Gold eligibility from `gate_count > 3` while retaining anomalous ineligible source Gold assignments and their warning codes.
- Keep manual post-lock star observations outside authoritative race facts until explicit reconciliation.
- Store economic amounts as exact signed atomic values against one asset/currency, keep BGC as a distinct asset kind and structurally exclude deposits, withdrawals, transfers, opening balances and reconciliation movements from operating P/L.
- Store Current Vault and Arena state as imported snapshots. Arena listings cannot create breeding income.
- Require hosted PostgreSQL CI to apply, smoke-test, reverse and verify removal of every migration before merge.
- The schema is repository-only. Neon, private uploads and Production remain unchanged and gated.

## 2026-07-22 — Phase 1 schema detection and quarantine

- Detect Race Merge, Core Details, Current Vault and Current Arena files from versioned header contracts, with explicit source selection allowed only when the selected schema requirements also match.
- Treat `bikeid` as a versioned Core Details alias for `core_id`; retain source-to-canonical column provenance.
- Record UTF-8 and Windows-1252 status and fail closed on unsupported or binary input.
- Quarantine malformed, unsupported, ambiguous, selection-mismatched, required-column-incomplete and duplicate-canonical-column headers before row normalization or persistence.
- Permit unknown extra columns only as provenance-preserving warnings; they do not silently become normalized facts.
- Restrict routine import summaries and logs to schema, encoding, counts and stable issue codes. Raw headers, filenames and values remain private staging data.
- Schema readiness is not dataset acceptance. Row validation, transactional activation and rollback remain separate controls.

## 2026-07-23 — Phase 1 synthetic source adapters

- Map Race Merge `rcb` to exact `distance` and use precise `rstart_time` as event time while retaining `event_datetime` as separate source provenance.
- Normalize the four supplied file families through conservative typed adapters; required identity, timestamp, mode, distance and structural failures quarantine the row.
- Preserve raw Gold and Blue values, nullable normalized values and complete/partial/missing/invalid status. Retain ineligible source Gold assignments with a warning and derive eligibility only from `gate_count > 3`.
- Treat the Bike-labelled file as cross-mode Core Details and normalize class, element, F-number and sex casing without losing source provenance.
- Keep name-only Current Vault identities in review and treat both Vault and Arena as historical snapshots.
- Preserve Arena prices as exact source decimals and structurally prevent a listing row from creating an economic transaction.
- Keep Race Merge fee, payout, prize and asset fields unvalidated; no economic transaction may be derived until source semantics satisfy Gate B.
- Routine adapter summaries expose counts and stable issue codes only. Raw headers and values remain private staging data.
- Transactional dataset activation, cumulative deduplication, conflict handling and rollback remain the next Phase 1 slice.

## 2026-07-23 — Phase 1 PostgreSQL dataset acceptance

- Stage only owner-scoped stable natural keys, SHA-256 fingerprints, source row numbers, readiness and issue codes at the dataset-acceptance boundary; raw CSV values remain outside this ledger.
- Serialize acceptance by owner and source before calculating the next version, and activate exactly one immutable version only after all transaction writes succeed.
- Store cumulative Race Merge/Core Details identities as immutable version deltas rather than copying the multi-million-row active set on every import; resolve the active set through non-rolled-back deltas.
- Treat Race Merge and Core Details as cumulative sources whose omitted accepted records carry forward; fingerprint disagreement is quarantined without overwriting the accepted fact.
- Treat Current Vault and Current Arena as replacement historical snapshots whose earlier versions remain rollback-capable.
- Reject a data-current-through regression without changing the active version, and keep import completion, data current-through and aggregate completion separate.
- Record one exact contribution per accepted natural key and batch. An accepted batch replay returns its existing version, while the owner/source/checksum constraint prevents duplicate file registration.
- Queue aggregate refresh after activation without claiming completion.
- Rollback requires a reason, preserves staged and contribution provenance, marks the active batch/version rolled back and restores the latest prior non-rolled-back version.
- Protect all acceptance tables with forced owner RLS and revoke table and function access from PUBLIC. Application-role grants and persistent Preview migration remain gated.
- Verify migration apply, exact replay, cumulative conflict handling, stale quarantine, snapshot replacement, atomic failure rollback, owner isolation, privilege revocation, rollback and full reverse migration in ephemeral PostgreSQL 16 CI.

## 2026-07-23 — Phase 1 star integrity contract

- Validate Gold and Blue assignments at event level before refreshing core profiles. Preserve zero, one and multiple assignments distinctly; multiple assignments retain every assigned source core ID and leave the unique assigned core null rather than selecting a false winner.
- Derive Gold eligibility only from `gate_count > 3`. Preserve and flag source Gold in one- to three-gate events, but exclude it from positive and negative Gold evidence.
- Create a signal assignment opportunity only when exactly one assignment exists, every event row is complete for that signal and core rows are unique. Missing or invalid Gold must not erase otherwise complete Blue evidence, or vice versa.
- Group star profiles by authoritative source core ID, mode and exact distance. Expose counts plus explicit numerator/denominator pairs; do not substitute an unexplained percentage.
- Treat complete eligible events with no Gold assignment separately from negative Gold opportunities. Keep incomplete, invalid, multi-assignment and duplicate-event evidence visible but excluded from the affected denominator.
- Make refresh deterministic across input ordering and replay, and fail closed on a repeated event ID so cumulative imports cannot double-count evidence.
- Keep PostgreSQL materialization pending until normalized Race Merge facts are transactionally persisted. Manual post-lock observations remain excluded until authoritative reconciliation succeeds.

## 2026-07-23 — Phase 1 normalized Race Merge materialization

- Require one private typed normalized Race Merge fact for every ready acceptance row and keep it owner-scoped with forced row-level security and no `PUBLIC` access.
- Accept and materialize normalized events, entries and source provenance within one owner/source-locked transaction; an unhandled failure rolls back activation and facts together.
- Quarantine every ready row for an event when event time, mode, exact distance or gate count conflict within a batch or with a previously accepted event. Never silently overwrite the accepted event identity.
- Use deterministic owner/event and owner/event/core identities with exact-replay idempotence, immutable batch provenance and optional links to authoritative Core Details IDs.
- Continue deriving Gold eligibility only from `gate_count > 3` while preserving ineligible source Gold assignments and warnings.
- Preserve exact elapsed-time and economic source values for audit, but leave normalized milliseconds, speed and race-derived economic transactions unavailable until their source semantics are validated.
- Rollback deselects the rolled-back batch's provenance and deactivates only materialized facts without another selected, non-rolled-back contribution.
- Verify migration apply, normalized-fact completeness, conflict quarantine, replay, provenance, rollback, owner isolation, privilege revocation and full reversal using synthetic PostgreSQL 16 CI. Neon, private uploads and Production remain unchanged and gated.

## 2026-07-23 — Phase 1 PostgreSQL star validation and profiles

- Refresh event validation and core star profiles only from active normalized historical Race Merge facts; manual post-lock observations remain excluded until authoritative reconciliation.
- Preserve zero, one and multiple Gold/Blue assignments separately. Store every ambiguous assigned source core ID in deterministic order and leave the unique assigned core null rather than selecting a false winner.
- Keep Gold and Blue completeness independent, derive Gold eligibility only from `gate_count > 3`, and retain ineligible source Gold as excluded anomalous evidence.
- Group profiles by authoritative source core ID, mode and exact distance with explicit coverage, received numerators and assignment-opportunity denominators. Complete zero-assignment events remain separate from negative opportunities.
- Atomically replace the owner's rebuildable derived cache and mark aggregate completion only after validation and profile writes succeed. Replay is deterministic and serialized per owner.
- Keep `data_current_through` as the latest included historical event timestamp and separate it from refresh completion time.
- Protect profiles with forced owner RLS and revoke `PUBLIC` table/function access. The reversible migration clears only rebuildable derived validation/profile state, never normalized race facts or source provenance.
- Verify multi-assignment ambiguity, three/four-gate eligibility, signal-specific completeness, exact denominator counts, replay, freshness, owner isolation, privilege revocation and full reversal in synthetic PostgreSQL 16 CI. Neon, private uploads and Production remain unchanged and gated.

## 2026-07-23 — Phase 1 manual star-observation reconciliation

- Reconcile optional post-lock observations only against active imported Race Merge history; never use them as pre-entry inputs, completed results or independent aggregate evidence.
- Permit automatic resolution only when the observation carries an authoritative game event ID and event metadata, entered-core set, Gold eligibility and imported Gold/Blue assignments validate.
- Treat composite date/time, mode, distance, gate count and entered-core matches as candidate-only. Even one exact candidate remains review-required and cannot be promoted automatically.
- Keep exact matches, imported/manual mismatches, malformed observations, incomplete or ambiguous imported star data, and not-yet-imported events as distinct auditable outcomes.
- Preserve Race Merge as the authoritative historical source. Reconciliation never mutates imported race entries, event validation or core star profiles.
- Use deterministic reconciliation identities and replace only unreviewed automatic suggestions on replay; reviewed rows are not overwritten and manual observations cannot duplicate star counts.
- Keep Gold unavailable at three gates or fewer and surface an ineligible manual Gold observation as a mismatch.
- Verify authoritative matching, candidate review, mismatch, not-yet-imported state, ineligible Gold, replay, aggregate non-mutation, privilege revocation and full reversal in synthetic PostgreSQL 16 CI. Neon, private uploads and Production remain unchanged and gated.

## 2026-07-23 — Phase 1 lineage graph and family validation

- Materialize owner-scoped transitive lineage reachability from resolved Core Details parent IDs, using parent, grandparent and distant generation bands without exposing names.
- Enforce only the confirmed family restrictions: a pair is ineligible for a parent, grandparent or full-sibling relationship.
- Keep half siblings, cousins, relationships beyond grandparent and other relationships eligible; do not widen the prohibited set without a later confirmed rule change.
- Treat same-core input as review-required rather than inventing a family rule. Treat incomplete class/parentage and cycles as review-required, and never silently infer missing parents.
- Preserve lineage anomalies separately from the graph, exclude cyclic self-reachability and make refresh serialized, deterministic and replay-safe per owner.
- Protect reachability and validation issues with forced owner RLS and revoke PUBLIC table/function access.
- Verify parent, grandparent, full-sibling, half-sibling, distant-descendant, incomplete and cyclic cases in both TypeScript and reversible synthetic PostgreSQL 16 CI. Neon, private Core Details uploads and Production remain unchanged and gated.

## 2026-07-23 — Phase 1 normalized Core Details materialization

- Require one owner-scoped normalized Core Details fact for every ready staged row before transactional activation.
- Treat the legacy Bike-labelled export as cross-mode Core Details and use `bikeid` only as the normalized source-core-ID alias.
- Use source parent IDs as authoritative. Preserve parent names as private provenance only; never resolve or create a lineage identity from a name.
- Quarantine self-parent, duplicate-parent, inconsistent core identity and active parent-role conflicts before changing the accepted dataset.
- Materialize cores and parent edges with deterministic owner-scoped IDs, immutable batch provenance and exact-replay idempotence.
- Retain unresolved source parent IDs as nullable placeholder identities so missing lineage remains reviewable instead of guessed.
- Expose only selected Core Details through the active view. Historical or rolled-back cores return a review-required family result and cannot silently re-enter breeding eligibility.
- Rollback deselects contributed core/edge provenance, restores the prior cumulative version and source pointers, retains historical evidence and refreshes only the selected lineage graph.
- Keep new tables under forced owner RLS and revoke PUBLIC table, view and function access. Verify activation, quarantine, replay, rollback, lineage, inactive-core protection and full reversal in synthetic PostgreSQL 16 CI.
- Neon, private Core Details uploads and Production remain unchanged and gated.

## 2026-07-23 — Phase 1 Current Vault and Arena snapshot materialization

- Materialize Current Vault and Current Arena as immutable historical snapshots tied to accepted dataset versions; never describe them as live state.
- Keep data current-through, import completion and activation timestamps separate, and retain stale or unknown freshness rather than inventing recency.
- Because Current Vault has no authoritative core ID, retain each row as snapshot-scoped evidence and create an owner-only identity review. A unique composite candidate may be proposed but is never auto-confirmed; ambiguous and unmatched rows remain unresolved.
- Preserve Maiden true, false, missing and invalid as distinct eligible, not-eligible, unknown and invalid snapshot states.
- Link Arena entries only by an exact selected Core Details source ID. Missing source IDs remain unmatched and reviewable without name inference.
- Store the exact Arena USD price source text without rounding, unit conversion or economic inference.
- Enforce that Arena listings create no income, expense or operating P/L transaction. Authoritative or manual transaction evidence remains required.
- Replace only the current snapshot pointer, preserve all historical snapshots, make replay idempotent and restore the prior snapshot on reasoned rollback.
- Keep typed staging and snapshot entries under forced owner RLS, revoke PUBLIC access and verify apply, replacement, identity review, exact prices, no false economics, rollback and full reversal in synthetic PostgreSQL 16 CI.
- Neon, private uploads and Production remain unchanged and gated.

## 2026-07-23 — Phase 1 import status and recovery workspace

- Replace the Imports placeholder with an owner-only historical-source workspace that keeps latest attempt, active accepted data, data current-through, import completion and aggregate refresh distinct.
- A newer quarantined attempt must not replace the active dataset or its freshness. Missing imports remain not-imported and unknown rather than implying live or complete data.
- Project recovery actions only from active accepted batches: reasoned rollback when a prior version exists, identity review, post-lock observation reconciliation and pending aggregate refresh.
- Keep routine summaries count/code-only. Exclude filenames, raw headers, core names, row values and batch identifiers from redacted logs and summaries.
- Reject impossible batch coverage, duplicate batch IDs and multiple active versions before rendering or acting on state.
- Keep private upload disabled until approved Preview-only Clerk, Neon and private object-storage configuration is available. The repository UI must state this boundary and Production remains fail-closed.
- Verify empty state, quarantined-attempt separation, freshness, recovery queues, validation failures, redaction, accessibility-oriented semantic markup, strict TypeScript and the full build using synthetic data only.

## 2026-07-23 — Phase 1 Gate B remains client-gated

- Do not accept Gate B or upload full private exports until authoritative Race Merge fee, payout, prize and asset semantics are confirmed; these values materially change financial totals and must not be inferred.
- Do not assume Neon Free capacity is sufficient for the detailed normalized-history model. The current free allowance is 0.5 GB per project, while the private capacity profile indicates a paid Preview database or a material R2 analytical-storage amendment may be required.
- Require the owner to choose and approve either a capped usage-based Neon Preview budget or a documented architecture amendment before detailed private history is hosted.
- Keep the first private upload, provider account creation/access and secret configuration as explicit client actions after the semantic and storage choices are resolved.
- Preserve completed repository evidence: owner RLS, revoked PUBLIC access, reversible migrations, idempotent source imports, star eligibility/anomaly rules, separate manual observations, exact asset accounting foundations, historical snapshot freshness and privacy-safe summaries.
- Production, custom domains, public routes and recurring paid infrastructure remain separately blocked at Gate F.

## 2026-07-23 — Race economics, USD valuation and free-tier storage

- `rpayout` is the payout mechanism label, not a monetary amount.
- `rfee` is the exact per-core race-entry fee and `prize` is the exact per-core gross payout. `toke_curr` identifies the common ETH or DEZ asset for both.
- A positive fee becomes an entry-fee debit and a positive prize becomes a payout credit. Numeric zero is authoritative; blank, missing, malformed and negative values remain review-required.
- `r_tags` contains race restrictions and must be preserved raw before versioned parsing.
- DEZ runs on Polygon at `0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E`.
- Preserve exact ETH/DEZ values and report race fees, payouts and net results in USD using one auditable rate for the race's UTC calendar day.
- Cache historical rates during background imports. Missing dates remain explicit and make USD totals partial; never substitute today's price or silently interpolate.
- BGC is separate, used for breeding and burning, and has an owner-confirmed USD 1 = BGC 1 reference conversion. Keep it out of ETH/DEZ operating P/L unless shown as a separate equivalent view.
- The owner approves private Cloudflare R2/Parquet for detailed race history and Neon Free for application state, manifests, exact economics, daily-rate cache and compact aggregates.
- Imports must stop before exceeding a published free allowance and must never enable a paid tier automatically.
- Do not attach the GroveKind domain. Keep the DNA site on protected Vercel Preview and Production fail-closed.

## 2026-07-23 — Exact race-economics domain contract

- Validate Race Merge fee/prize/asset data independently from structural race validity so malformed economics cannot erase legitimate performance history.
- Normalize only ETH and DEZ as racing assets. Keep BGC outside race-derived transactions.
- Derive no transaction from `rpayout`; it remains the payout-mechanism label.
- Create at most one negative fee transaction and one positive payout transaction for an accepted owned-core entry, using existing stable economic keys.
- Omit zero-value ledger rows while preserving authoritative zero source values.
- Use exact decimal strings and `BigInt` arithmetic for transformations and USD multiplication.
- Key rates by the event's UTC calendar date. A missing rate returns unavailable rather than falling back or interpolating.
- Pin provider series identities to CoinGecko Ethereum and the confirmed Polygon DEZ contract.

## 2026-07-23 — Race-derived ledger and daily-rate persistence

- Decision: materialize non-zero `rfee` and `prize` values as exact, signed,
  owner-scoped race transactions after dataset acceptance.
- Decision: retain `rpayout` and `r_tags` as separate source labels; neither is
  interpreted as an amount.
- Decision: keep the generic ledger category until race-format-specific accounting
  classification is independently validated, while using source-confirmed
  `race_entry_fee` and `race_prize` subcategories.
- Decision: accept one immutable USD rate per owner, asset and UTC date, with exact
  provider provenance and explicit missing-rate coverage.
- Decision: BGC remains excluded from race-derived economics and no current-price
  fallback, interpolation or page-time quote call is permitted.
- Evidence: migration 0009 and its synthetic PostgreSQL smoke test.

## 2026-07-23 — Race-economic ledger hardening amendment

- Supersedes the initial migration 0009 implementation before any Preview provider migration is applied.
- Create personal race P/L only for race entries whose core is confirmed in the current Vault identity review; other competitors remain performance evidence only.
- Use the TypeScript stable race-economic natural key and an immutable batch-contribution layer so cumulative replay and dataset rollback cannot double count.
- Permit auditable provider supersession and manual correction of a UTC-daily rate while retaining prior rates and valuations as non-current history.
- Keep exact original-asset values authoritative and mark USD coverage partial whenever an active transaction lacks a current daily rate.

## 2026-07-23 — Phase 2 core performance contract

- Begin Phase 2 repository work while the first full private hosted import remains separately gated by Preview provider configuration and capacity evidence.
- Accept performance observations only after elapsed time has been normalized to a positive integer millisecond value; do not guess the legacy source unit inside the analytical profile.
- Key every profile by authoritative core ID, mode and exact distance. Bike, Car and Horse evidence and different exact distances never merge.
- Keep fewer than 10 races hypothesis-only and label 10 or more minimally analytical rather than proven.
- Expose best, median, mean, trimmed mean, population standard deviation, interquartile range and derived speed with transparent formulas and higher-speed/lower-time direction.
- Link Gold/Blue evidence only from the matching core, mode and exact-distance profile while preserving eligibility, numerators, denominators and anomaly coverage.
- Keep every profile experimental until Gate C chronological holdout, baseline and calibration evidence passes. Synthetic verification cannot establish analytical success.
- Expose the historical data cutoff and freshness state; never describe the result as live.

## 2026-07-23 — Race distance unit

- The repository owner confirms that race distance values are measured in metres.
- Phase 2 derived speed may therefore be labelled in metres per second after elapsed time is validated and normalized to milliseconds.

## 2026-07-23 — Phase 2 Core Intelligence workspace

- Replace the Core Intelligence scaffold with an accessible historical-snapshot workspace backed only by validated compact profiles.
- Keep the repository route in an explicit empty state until accepted normalized performance data is connected; never render missing metrics as zero.
- When data exists, show exact mode/distance evidence, sample status, time, metres-per-second speed, Gold/Blue numerators and assignment-opportunity denominators, data cutoff, import time, freshness and experimental status.
- Do not enable analytical recommendations or dependability wording before Gate C.

## 2026-07-23 — Phase 2A separate BGC ledger

- Report BGC as a separate game-credit ledger with manual opening balances, actual burn credits, recorded arena-fee spend, signed adjustments and balanced internal transfers.
- Require two distinct exact postings that net to zero for an internal transfer; transfers affect account balances but never vault earned, spent or net movement.
- Derive a BGC balance only when period coverage is complete, every active account has explicit opening evidence, reconciliation is resolved and the data cutoff is known.
- Keep recorded movement visible but the balance unavailable when coverage is insufficient; never assume an unrecorded opening balance is zero.
- Expose the owner-confirmed USD 1 = BGC 1 reference only as a separately labelled equivalent of a supportable BGC balance.
- Exclude BGC from ETH/DEZ operating P/L and total recorded crypto cashflow.

## 2026-07-23 — Phase 2A core economic profiles

- Include only exact transaction amounts explicitly allocated to the selected authoritative core ID; never repeat a shared transaction's full amount across related cores.
- Keep related vault-level activity visible as unallocated evidence without adding it to per-core totals.
- Separate open racing, tournament, breeding, acquisition, sale, selling-fee, burn-credit and other lifecycle components by original asset.
- Keep BGC separate and limit it to actual allocated breeding spend and manually recorded burn credits in the core profile.
- Calculate realised core-trading result only when cost-basis coverage is explicitly known in the same asset; otherwise show proceeds and a missing-or-unconvertible cost-basis warning.
- Exclude unsold-core estimates, combined unlike-asset totals and complete-lifetime-profit claims.

## 2026-07-23 — Phase 2A economic ledger filters

- Filter immutable ledger evidence by inclusive period, original asset, category/subcategory, linked core, mode, exact metre distance, approved inclusive distance band, tournament and bracket.
- Use OR within one filter dimension and AND between dimensions; retain deterministic timestamp/transaction ordering.
- Preserve the approved overlapping distance-band boundaries: 1400 may match sprint or middle and 1800 may match middle or marathon.
- Keep genuine vault-level payouts unallocated. They remain visible without a core filter and are excluded, not reassigned, when a core filter is applied.
- Omit excluded/duplicate evidence by default and include it only through an explicit filter while retaining its status and count.
- Do not use the obsolete race-class field, combine assets, infer attribution or change any reconciliation state.


## 2026-07-23 — Phase 2A asset-separated reporting completeness

- Aggregate included ledger records with exact decimal arithmetic by original asset; never expose an unsupported combined cross-asset total.
- Keep BGC in a separate game-credit result and restrict the BGC-movement scope to BGC records. Do not apply its reference USD equivalent silently.
- Exclude non-operating deposits, withdrawals, transfers, opening balances and reconciliation movements from activity cashflow.
- Classify a report as partial for incomplete period coverage, unknown cutoffs or manual payouts, unclassified activity, unresolved reconciliation, scope-relevant missing cost basis/opening balance or missing conversion rates.
- Use estimated only when evidence is otherwise complete and an explicitly requested converted view uses estimated rates.
- Retain data-current-through, last-imported, excluded-record count and warnings; never authorize a complete lifetime-profit claim from this contract.


## 2026-07-23 — Phase 2A ledger duplicate and reconciliation controls

- Compare duplicate evidence only within the same asset and exact signed amount; unlike assets and opposite directions never become candidates.
- Treat stable-key, external-reference and same-UTC-date amount/context matches as review evidence with explicit priority. No candidate may auto-exclude or auto-merge a transaction.
- Preserve accepted ledger facts. Exclusions and confirmed-duplicate links are recoverable aggregate overlays with reasons and ordered audit actions.
- Implement a correction as an exact opposite signed reversal record while retaining the original and reversal in aggregation so the pair nets to zero.
- Require a distinct active survivor for confirmed duplicates, unique transaction/action/reversal identities and valid action ordering; unsupported runtime values fail closed.
- Keep this repository contract independent of hosted economic records, campaign classification, private provider state and Production.


## 2026-07-23 — Phase 2A manual ledger validation

- Accept owner-entered amounts only as positive plain base-10 decimal strings and
  derive exact signed postings without binary floating point.
- Allowlist manual category/subcategory combinations. Structurally exclude
  deposits, withdrawals, internal transfers, opening balances and adjustments
  from operating P/L.
- Materialize an internal transfer as equal debit and credit postings in the
  same asset between distinct labelled accounts.
- Keep every asset separate. Limit BGC to its distinct game-credit ledger for
  actual burn credits, arena fee spending, opening balance and adjustments; do
  not apply a silent cash/crypto conversion.
- Require tournament provenance for manual game-owner payouts while permitting
  genuine vault-level payouts to remain unallocated with a partial warning.
- Record core-sale proceeds with a missing-cost-basis warning rather than
  fabricating realised profit.

## 2026-07-23 — Phase 2A manual tournament payout allocation

- Preserve a manual game-owner prize as operating income in its original crypto or fiat asset and always require duplicate/reconciliation review.
- Permit genuine tournament- or vault-level prizes to remain unallocated rather than inventing per-core attribution.
- Support single-core, equal, exact-amount, exact-percentage and documented-points allocation methods.
- Require explicit allocations to reconcile exactly to the original payout at the configured asset precision using integer atoms and deterministic largest-remainder apportionment.
- Use core ID as the deterministic tie-break and reject allocations that cannot give every selected core a positive amount at the asset precision.
- Keep BGC outside manual tournament payouts and in its separate game-credit ledger.

## 2026-07-23 — Phase 2A tournament campaign economics

- Aggregate only included operating records linked to the selected tournament and inclusive campaign period.
- Keep qualification fees, qualification payouts, automated round/final payouts, manual prizes and campaign expenses visible as separate components.
- Preserve exact original-asset values, keep BGC separate and never provide a combined unlike-asset total.
- Retain vault-level tournament prizes as unallocated campaign evidence instead of inventing per-core attribution.
- Expose inferred or unclassified activity, unresolved reconciliation, source-coverage gaps, manual-payout uncertainty and an unknown data cutoff.
- `complete_recorded_period` applies only to the stated recorded coverage and never permits a complete-lifetime-profit claim.

## 2026-07-23 — Phase 2A Vault Performance summary

- Aggregate only included immutable ledger evidence inside the selected period.
- Keep ETH, DEZ, fiat assets and BGC separate; no combined-asset total is available and BGC never enters cash/crypto profit.
- Show open racing, qualification, later tournament stages, manual prizes, breeding, core trading and other lifecycle activity as distinct exact totals.
- Exclude deposits, withdrawals, internal transfers, opening balances and reconciliation adjustments from operating cashflow.
- Withhold realised core-trading results whenever a sale lacks known same-asset cost-basis evidence.
- Keep reports partial for incomplete coverage, unknown manual payouts, unresolved classifications or reconciliation, missing cutoffs or stale imports.
- Never permit the recorded-period summary to be described as lifetime profit.
