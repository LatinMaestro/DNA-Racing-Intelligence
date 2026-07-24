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

## 2026-07-23 — Phase 2 current Vault registry contract

- Build the active Vault only from confirmed durable Core Details IDs. Proposed name/composite candidates remain identity-review evidence and cannot create ownership, race P/L or recommendations.
- Use the current accepted Vault snapshot as the baseline, then apply reasoned manual add/remove events at or after that snapshot import time in deterministic chronological order. Retain older manual history as superseded rather than deleting it.
- Permit a manual-only durable-ID registry before the first snapshot, with snapshot freshness explicitly unknown.
- Preserve eligible, not-eligible, unknown and invalid imported Maiden states. Manual overrides may set eligible, not eligible or unknown only for an active core and must not themselves establish ownership.
- Keep active owned cores with missing Core Details visible with a warning rather than silently dropping or completing them.
- Expose Current Vault data-current-through, last-imported and freshness separately. Use synthetic IDs only in Git; hosted persistence, private names and UI mutations remain later focused slices.

## 2026-07-24 — Verified private-source aggregate contract

- The authoritative inspected source set contains six sequential Race Merge exports and one export each for Core Details, Current Vault and Current Arena.
- Approved privacy-safe profiling records 2,536,710 race entries across 695,901 events and 16,992 raced core IDs; 18,127 Core Details IDs; 195 owner-confirmed current-Vault cores, including 68 Maiden Eligible; and 792 current-Arena listings.
- The six Race Merge exports have 13 overlapping boundary events containing 67 exact duplicate entries and no observed conflict. Imports must append and deduplicate while quarantining any future conflict.
- All 195 current-Vault rows resolve deterministically to Core Details and have race history. ME is a separate eligibility state, not an ownership filter.
- Core Details provides both parents for 14,181 cores and founder/no-parent state for 3,946. Of the current owned cores, 166 have recorded parents and 29 are founder/no-parent records.
- Explicit partial-profile states remain required for 2,162 raced IDs absent from Core Details, one Arena ID absent from Core Details and 22 Arena IDs without race history.
- Historical BGC race entries remain performance evidence but are accounted as free-entry, no-payout races: effective fee and payout are zero, no race ledger transaction is created and source monetary fields are excluded from economic totals.
- Git may retain these approved aggregates and rules only. Raw files, filenames, identities, individual records, monetary values and user-specific derived records remain excluded.

## 2026-07-24 — Periodic source updates and analytical fidelity

- The owner will refresh the website through a private Data Updates workspace rather than editing database tables or GitHub files.
- Race Merge exports are sequential append sources and may be added in groups; Core Details is versioned/upserted by durable ID; Current Vault and Current Arena are replacement historical snapshots.
- The owner-facing sequence is upload, detected update preview, confirmation, background processing, completion report and reasoned rollback where required.
- Authenticated owner review may show exact filenames, rows and field values when useful for correcting an import; automated logs, Git, CI and public surfaces remain redacted.

## 2026-07-24 — Data Update preview and confirmation contract

- Build one deterministic pre-confirmation plan from staged-file inspection evidence; the preview cannot mutate active data.
- Permit grouped Race Merge additions and order them by accepted event coverage. Treat Core Details as a single versioned durable-ID upsert and Current Vault/Arena as single replacement snapshots.
- Report accepted, exact-replay, exact-duplicate, conflict, malformed and warning counts separately.
- Block confirmation on unsupported schemas, conflicts, malformed rows, duplicate uploads or competing single-file source candidates.
- Keep confirmation explicit and start only bounded background processing after it; completion reporting and reasoned rollback remain separate stages.
- Permit exact row-level evidence in the authenticated owner review workspace while keeping Git, routine logs and public surfaces redacted.
- The source exports are publicly available DNA Racing data and the website is private. Privacy controls must not remove or suppress analytically relevant fields or compromise recommendations.
- Preserve original source files and values in the private raw-data boundary, subject to approved capacity limits. Compact application tables may omit redundant or unused fields only when the raw values remain recoverable and current analysis is unaffected.
- The owner should upload ordinary exports without manually reshaping them. Unsupported source changes fail closed while the prior accepted dataset remains active.
- Production and the first persistent private Preview import remain subject to their existing Gates F and B respectively.

## 2026-07-24 — Verified real-source race-economic compatibility

- A complete private compatibility pass found a small set of otherwise-valid historical ETH rows whose fee uses base-10 scientific notation. Exact-decimal normalization now accepts plain or scientific notation using string and `BigInt` arithmetic only; binary floating point remains prohibited.
- Historical BGC Race Merge rows use the owner-confirmed `historical_non_economic` state. They remain valid performance evidence, preserve private source provenance and have zero effective fee and payout.
- A historical BGC race creates no ETH, DEZ or BGC race-derived transaction and no economic reconciliation/completeness item merely because its source race asset is BGC.
- Genuinely unknown race assets remain unsupported and review-required.
- Synthetic TypeScript coverage verifies scientific ETH normalization, exact transaction derivation, BGC zero-effective treatment, absence of BGC ledger rows and continued fail-closed handling of unsupported assets.
- Reversible migration smoke coverage now encodes assertions that the durable BGC state is constrained, materializes as economically validated and produces neither a transaction nor a review item. Exact PostgreSQL execution remains mandatory before merge.
- Private source records, identities, filenames and amounts remain outside Git. Only the previously approved aggregate compatibility result is documented.

## 2026-07-24 — Phase 2 deterministic Vault identity resolution

- Treat every accepted Current Vault row as owner-confirmed ownership evidence. The Maiden field remains a separate eligible/not-eligible/unknown/invalid state.
- Confirm identity only when normalized exact name plus class, element, F-number and sex selects one Core Details durable ID, or when a prior confirmed private signature still points to a present attribute-consistent ID.
- Reused names are safe only when the full composite selects exactly one durable ID. Names never create lineage, ownership attribution or personal economics by themselves.
- Future unmatched names, attribute inconsistencies, ambiguous composites, stale/conflicting prior mappings and duplicate resolved-core assignments remain review-required.
- A review-required row remains owned-snapshot evidence but cannot create a durable profile, personal race P/L or recommendation until identity is confirmed.
- The resolver is deterministic across source ordering, keeps candidate IDs sorted, rejects duplicate source/core identifiers and uses synthetic repository fixtures only.
- The inspected current snapshot is separately confirmed to resolve all 195 owned rows with 68 eligible and 127 not eligible; no private identity map enters Git.

## 2026-07-24 — Phase 2 Core source coverage

- Join Core Details, confirmed Current Vault identities, Current Arena and Race Merge history by authoritative durable ID only.
- Preserve four explicit analytical states: ready, performance-only, no imported racing history and source identity only. Missing evidence is unavailable, never a zero or a negative quality result.
- Treat a parentless Genesis Core Details record as a complete founder. Non-Genesis lineage is checkable only with exactly two distinct parent IDs that both resolve in accepted Core Details.
- Keep partial, unresolved, duplicated or class-inconsistent parentage review-required. A checkable source state does not bypass the dedicated family-restriction decision.
- Recompute affected source coverage after accepted activation or rollback and carry data freshness and cutoff into downstream displays.
- The inspected source aggregates imply all 195 owned cores are ready; 2,162 raced IDs are performance-only; and 22 current-Arena IDs have no imported racing history. These are snapshot coverage findings, not permanent constants.
- Synthetic hosted verification covers deterministic ordering, owned-ready, founder, performance-only, no-history, identity-only and invalid-lineage cases. Exact-head CI and persistence integration remain pending.

## 2026-07-24 — Owner-scoped import read-model service

- Replace the Imports route's hardcoded empty 1970 projection with a dynamic Server Component and provider-neutral application service.
- Require both an authenticated session owner ID and the single configured allowlist ID before persistence may be queried. Missing identity stays explicitly disconnected; a mismatch fails closed.
- Query a ready import-batch repository only with the verified owner ID. Do not turn malformed persisted batch evidence into an empty or successful state.
- Keep the repository adapter explicitly not configured until approved Preview identity and Neon access exist. Never initialize a provider SDK at module scope or during `next build`.
- Distinguish identity unavailable, persistence unavailable and read-model connected states in the owner UI without exposing private identifiers.
- Keep raw upload and background processing disabled even when the historical read model is connected; they remain separate gated implementation work.

## 2026-07-24 — Owner data-update preview contract

- Group staged files by Race Merge, Core Details, Current Vault and Current Arena before owner confirmation.
- Treat Race Merge as chronological append history, Core Details as a durable-ID versioned upsert, and Vault/Arena as single replacement snapshots.
- Report accepted, exact replay, exact duplicate, conflicting, malformed and warning counts without mutating the active dataset.
- Block confirmation for unsupported schemas, conflicts, malformed rows or multiple competing snapshot/upsert candidates. Visible warnings and exact duplicates do not block an otherwise valid plan.
- Require explicit owner confirmation before background processing starts. The preview itself never activates data, deletes provenance or changes Production.

## 2026-07-23 — Phase 2 distance-band projection

- Build Sprint, Middle and Marathon views as descriptive projections over exact-distance profiles; exact-distance evidence remains primary.
- Preserve the owner-confirmed inclusive definitions: Sprint 900–1400 m, Middle 1400–1800 m and Marathon 1800–2200 m.
- Show 1400 m in both Sprint and Middle and 1800 m in both Middle and Marathon, with explicit shared-boundary counts rather than silently selecting one band.
- Do not pool elapsed times across different distances. Summarize comparable metres-per-second evidence while retaining each exact-distance distribution.
- Aggregate Gold/Blue evidence only by adding auditable counts and denominators, never by averaging rates.
- Use the conservative worst freshness represented in the band, retain missing-star and outside-band warnings, and keep all outputs experimental until Gate C.

## 2026-07-23 — Phase 2 evidence confidence and coverage

- Define confidence as evidence maturity, not predicted racing quality. The
  confidence projection does not consume elapsed times, speed values, star rates
  or benchmark percentiles when assigning its level.
- Keep direct exact-distance sample sufficiency, Gold/Blue coverage and
  anomalies, benchmark completeness, lineage resolution, freshness and
  chronological validation as separate auditable components.
- Treat no direct evidence as insufficient and fewer than 10 exact-distance
  races as low confidence. Ten races is minimally analytical only and cannot
  produce high confidence by itself.
- Require current or ageing data, complete benchmark outcomes and passed
  chronological holdout, simple-baseline and calibration checks before high
  confidence is possible.
- Keep incomplete validation experimental. A validated evidence label is not an
  actionable recommendation or proof that a core is strong.
- Preserve missing, partial, invalid and anomalous supporting evidence as
  explicit warnings. Never turn missing star or lineage evidence into a zero
  quality assessment.

## 2026-07-23 — Phase 2 family tree projection

- Project one authoritative root core into deterministic parent, grandparent,
  ancestor, child, grandchild, descendant, full-sibling and half-sibling
  relationships.
- Use source core IDs only for identity. Display names remain optional labels and
  never resolve missing lineage.
- Retain unresolved parents as visible placeholders and make incomplete,
  duplicated, self-referential and cyclic lineage review-required.
- Do not allow malformed lineage unrelated to the selected root to contaminate
  its projection.
- Keep family-tree display separate from the confirmed breeding-eligibility
  decision; do not add family restrictions or inherited-quality claims.
- Stage this repository work without a pull request while GitHub-hosted runners
  are unavailable. Full exact-head CI remains mandatory before merge.

## 2026-07-23 — Phase 2 performance benchmarks

- Build historical benchmark distributions separately by mode, exact distance,
  gate count and preserved format label.
- Keep elapsed milliseconds authoritative and expose a transparent
  faster-than-or-equal percentile whose user-facing direction is
  higher-is-better.
- Require complete event coverage before creating winner or in-the-money
  distributions. Partial events may contribute valid time evidence only.
- Keep in-the-money status explicit and unknown-capable; do not infer it from
  finishing position or payout-format assumptions.
- Keep every benchmark experimental until Gate C chronological holdout,
  baseline, calibration and no-leakage evidence passes.
- Stage this repository work without a pull request while GitHub-hosted runners
  are unavailable. Full exact-head CI remains mandatory before merge.

## 2026-07-23 — Phase 2 chronological pre-race field context

- Build historical opponent context only from performance and star evidence with
  an event timestamp strictly earlier than the event being assessed.
- Exclude the target event, simultaneous events and all later races, and expose
  excluded-evidence counts so the no-leakage boundary is auditable.
- Match opponent history only by authoritative core ID, mode and exact distance.
  Never merge Bike, Car and Horse, adjacent distances or the entered core's own
  history into opponent field evidence.
- Expose each opponent's prior race count, best/median elapsed time, latest prior
  event and prior Gold/Blue profile, plus complete/partial/unavailable coverage.
- Keep missing opponents missing rather than treating them as average or weak.
- Leave strong, weak and elite field bands unclassified until a benchmark frozen
  at the historical cutoff is supplied and chronologically validated.

## 2026-07-23 — Phase 2 star trend candidates

- Summarize validated Gold and Blue assignment frequency by explicit historical
  period, mode and exact distance with assigned, no-assignment, excluded and
  opportunity counts.
- Exclude Gold-ineligible events from Gold opportunity denominators and keep
  Gold and Blue evidence independent.
- Keep race outcomes, elapsed times, prizes and future races outside the
  assignment-frequency trend input.
- Compare only adjacent configured periods with sufficient opportunities and
  label threshold crossings as descriptive change candidates, never confirmed
  hidden-algorithm eras.
- Keep all trend outputs experimental pending Gate C and Phase 9 chronological
  stability and predictive-lift evidence.
- Stage this repository work without a pull request while GitHub-hosted runners
  are unavailable. Full exact-head CI remains mandatory before merge.

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

## 2026-07-23 — Phase 3 Discovery evidence agreement

- Classify time/star agreement only for one authoritative core, mode and exact
  distance while preserving direct time as primary evidence.
- Keep Gold eligibility, Gold assignment opportunities and Blue assignment
  opportunities separate and auditable.
- Treat repeated weak-field eligible no-star evidence as supporting negative
  evidence only; it cannot authorise an automatic stop.
- Keep time/star mismatch explicit, preserve data cutoff separately from import
  completion, and fail closed on incomplete, stale or unknown-cutoff evidence.
- All outputs remain experimental, non-actionable and incapable of confirming
  core quality before Gate C.

## 2026-07-23 — Phase 3 Discovery evidence matrix

- Key every Discovery cell by authoritative core ID, mode and exact distance; never merge Bike, Car and Horse or different exact distances.
- Preserve direct elapsed-time evidence, the 10-race minimum, lineage priority, star denominators, ME/tournament context and freshness as separate auditable inputs.
- Keep zero direct races as unavailable metrics rather than fabricated zero times, and keep fewer than 10 races hypothesis-only.
- Reject lineage evidence after the cell cutoff and repeated lineage support from the same relationship/source identity.
- Preserve Gold eligibility and Gold/Blue assignment-opportunity denominators; inconsistent counts fail closed.
- Keep no-star evidence non-dispositive: it cannot create an automatic stop.
- Expose no composite quality score or actionable recommendation until Gate C holdout, baseline and calibration evidence passes.

## 2026-07-23 — Phase 3 chronological Discovery holdout

- Compare a time-plus-star candidate with a time-only baseline using pre-event
  probabilities and competitive-time outcomes.
- Require strictly ordered training and holdout windows and a feature cutoff
  strictly earlier than every evaluated event.
- Use authoritative event and core IDs to prevent duplicate holdout evidence.
- Report Brier score, incremental lift, calibration, sample size and star-feature
  coverage overall and by exact mode/distance cell.
- Keep synthetic evaluation non-dispositive: it cannot self-pass Gate C or enable
  actionable Discovery recommendations.

## 2026-07-23 — Phase 3 unexpected outlier review

- Identify unexpected outlier candidates only from exact-distance time evidence that clears both a versioned elite threshold and a configured gap above prior expectation.
- Keep single and repeated exceptional observations distinct and never confirm elite quality from a review candidate.
- Use strong-field stars as supporting context only; stars cannot create an outlier without elite time evidence.
- Treat missing priors, incomplete observations, stale data and unknown cutoffs explicitly and fail closed where comparison is not auditable.
- Keep all outputs experimental and non-actionable until Gate C passes.

## 2026-07-23 — Phase 3 Discovery path review

- Keep elapsed-time evidence primary in early continue/stop review; thresholds are explicit versioned inputs.
- Permit early strong-field star evidence to support continued review below the minimum sample, but never let stars override materially weak time.
- Require the minimum direct sample plus weak time evidence before producing even a non-actionable stop candidate.
- Treat no-star evidence as non-dispositive, hold time/star mismatches for review, and fail closed on stale or unknown-cutoff evidence.
- Keep all outputs experimental and non-actionable until Gate C passes.

## 2026-07-23 — Phase 3 Discovery probe planning

- Treat targeted probes as an experimental evidence-review queue until Gate C; do not issue an entry, spending or stop instruction.
- Keep Bike, Car and Horse separate by exact distance and preserve the 10-race minimum as a coverage boundary rather than proof.
- Use resolved lineage, tournament relevance and Maiden status only to prioritise review of evidence gaps; direct time evidence remains primary.
- Defer stale, unknown-cutoff and unresolved-Maiden candidates, and warn before any action could commit Maiden eligibility.

## 2026-07-23 — Phase 3 tournament and Maiden Discovery priority

- Require credible Bike, Car and Horse evidence before identifying a provisional
  strongest mode for an ME core.
- Require the strongest mode to clear a versioned evidence gap; otherwise request
  more cross-mode Discovery.
- Label a configured Maiden in a weaker mode `preserve ME`; never commit ME from
  the first available Maiden.
- Treat tournament relevance as review priority only and retain the configured
  leaderboard objective.
- Keep every output experimental and non-actionable until Gate C, with final
  Maiden entry separately disabled until Gate D.

## 2026-07-23 — Phase 4 tournament configuration contract

- Represent tournament qualification as owner-entered tournament and bracket
  rules rather than hardcoded examples.
- Preserve mode, exact distances, gate count, exact fee/asset, eligibility,
  leaderboard split, minimum sample, ranking metric and qualification threshold
  independently for each bracket.
- Support shared, separate and unknown qualification race pools. Unknown or
  uncertain rules remain review-required, and a declared shared pool must link
  at least two brackets.
- Normalize entry fees and points as exact base-10 decimals and fail closed on
  malformed, negative, overlapping or internally inconsistent rules.
- Do not rank cores, allocate entries, classify imported races or target the
  50% gate cap in this contract. Gate C evidence and later Phase 4 contracts
  remain required before actionable qualification recommendations.

## 2026-07-23 — Phase 4 tournament eligibility contract

- Evaluate tournament eligibility only from confirmed active ownership,
  availability, class, element, F-number and Maiden rules.
- Support explicit non-overlapping leaderboard groups, including combined
  element, class and F-number groups. A core matching zero or multiple configured
  groups remains review-required rather than being assigned arbitrarily.
- Treat confirmed rule mismatches as ineligible, but keep unresolved identity,
  attributes, Maiden state, availability and stale/unknown imported evidence in
  a separate review-required state.
- Preserve data-current-through, last-imported and freshness evidence and never
  describe imported ownership or eligibility as live.
- Use no time, finish or star evidence and permit no automatic entry in this
  eligibility-only contract.

## 2026-07-23 — Phase 4 tournament candidate ranking contract

- Order candidates only by the bracket's configured qualification-metric rank
  within the same leaderboard group.
- Keep historical Gold/Blue evidence as supporting rationale only. It cannot
  improve rank or override materially weak time evidence.
- Hold incomplete, unresolved, low-confidence, stale or unknown-cutoff evidence
  outside the review order rather than forcing a recommendation.
- Label a Maiden-eligible core reserved for a stronger projected mode
  `preserve ME`, even when it ranks strongly in the available bracket.
- Preserve data-current-through, last-imported and freshness separately and
  reject duplicated identities, duplicated group ranks and inconsistent metric
  availability.
- Keep all output historical, experimental and non-actionable. Current-field
  claims, Auto-Entry and final Maiden entry decisions remain unavailable until
  their mandatory Gates C and D evidence passes.

## 2026-07-23 — Phase 4 tournament entry allocation contract

- Allocate only the explicitly requested initial probe races for reviewable
  candidates. Never add entries merely to consume spare capacity.
- Enforce the owner-confirmed 50% rule as a hard maximum using the whole-number
  floor of configured gates. Existing planned owned entries count toward it.
- Keep one core to at most one entry per planned race and preserve any excess
  request as unallocated rather than weakening the cap.
- Exclude held, ineligible and `preserve ME` candidates from allocation.
- Require current-field confirmation for every plan because imported history
  cannot establish live occupancy or outside entries.
- Keep the result review-only and incapable of an automatic game action. Gate C
  remains mandatory before actionable Auto-Entry guidance.

## 2026-07-23 — Phase 4 tournament path guidance contract

- Require both sufficient consistently weak configured-metric evidence and weak
  time evidence before producing a stop candidate.
- Keep eligible no-star evidence non-dispositive and exclude Gold-ineligible
  no-star evidence. Neither may produce a stop.
- Permit strong-field historical stars to support only a limited early
  continuation when time is not weak.
- Pause time/metric disagreement, unavailable or low-confidence evidence, stale
  or unknown cutoffs, exhausted budget and reached probe limits for review.
- Preserve an uncommitted ME core when cross-mode evidence identifies a stronger
  projected Maiden mode.
- Reject future and duplicate attempts, keep imported timestamps separate and
  keep every signal experimental and non-actionable pending Gates C and D.

## 2026-07-23 — Phase 4 qualification-metric evidence contract

- Translate historical observations into the bracket’s configured fastest,
  median, average, wins, Top-X, best-finish or points metric without substituting
  a generic quality or star score.
- Keep mode, exact-distance, bracket and leaderboard-group evidence separate.
  Rank only within the same configured leaderboard group.
- Calculate median and average time as exact rational milliseconds and points as
  exact base-10 decimals.
- Preserve incomplete samples, missing time/finish evidence, data-current-through,
  last-imported and freshness warnings. Reject current-event/future, cross-mode,
  unconfigured-distance, duplicate-event and impossible-position evidence.
- Keep the rank experimental and historical. The current qualifying field,
  Auto-Entry allocation and actionable recommendations remain unavailable until
  Gate C evidence passes.

## 2026-07-23 — Phase 4 historical tournament race classification

- Classify only imported historical races; no output represents live tournament state or gate occupancy.
- Confirm an authoritative source stage only when the configured tournament rule agrees on identity and race conditions.
- Treat one exact configured match without authoritative stage evidence as a review proposal, never an aggregate-ready fact.
- Preserve overlapping matches, uncertain rules, source/configuration conflicts and unmatched races as review-required rather than forcing a category.
- Do not infer ordinary open racing merely because no tournament rule matched.
- Match exact entry-fee evidence with exact-decimal normalization and preserve mode, distance, gate count and UTC window as auditable evidence.

## 2026-07-23 — Phase 4 recoverable tournament campaign linking

- Preserve imported race facts and source labels as immutable evidence.
- Apply tournament, bracket, leaderboard and stage attribution through reasoned link, correction, unlink and restore overlays.
- Require unique action identity, chronological ordering and exact optimistic revision for every change.
- Exclude an unlinked race from campaign totals without deleting its history.
- Restore only the prior audited link; do not manufacture attribution during recovery.
- Keep campaign linking historical and independent of live tournament state.

## 2026-07-23 — Phase 4 manual external-prize reconciliation

- Compare manual external tournament prizes with imported race payouts using exact external references and conservative same-asset/date/amount/tournament candidates.
- Surface incompatible facts sharing one reference as a conflict.
- Never auto-exclude a suspected duplicate.
- Require a reasoned confirmation before excluding the manual record; preserve the imported payout as immutable evidence.
- Permit a reasoned separate-payment decision so legitimate race and wallet prizes both remain included.
- Do not require artificial core allocation for a vault-level overall prize.

## 2026-07-23 — Phase 5 Maiden bracket suitability

- Evaluate Maiden suitability against the configured bracket's actual distances,
  leaderboard objective, eligibility and tournament structure.
- Require sufficient time-led evidence and configured-metric fit at every
  expected distance; missing or weak evidence holds the candidate.
- Keep Gold/Blue star evidence supporting only and prohibit it from overriding
  weak time.
- Preserve an entitlement for weaker modes and retain exact tournament identity
  for planned or committed states.
- Keep closed, consumed, ineligible, unresolved and committed-elsewhere outcomes
  distinct.
- Treat a fully supported strongest-mode bracket as a non-actionable review
  candidate until Gates C and D pass.

## 2026-07-23 — Phase 5 Maiden cross-mode comparison

- Compare a Maiden-eligible core across Bike, Car and Horse before identifying a
  strongest projected mode.
- Use a configured, versioned time-led projection score with explicit distance,
  leaderboard objective, tournament-structure, evidence and freshness context.
- Require credible evidence in all three modes and a material configured gap.
- Keep historical Gold/Blue evidence and alternative-core scarcity explanatory;
  neither changes the projection score or rank.
- Label weaker available Maidens `preserve ME` and wait when the strongest mode
  has no active tournament.
- Keep all outputs non-actionable until Gates C and D pass.

## 2026-07-23 — Phase 5 Maiden commitment review

- Require a warning-gated review before any future Maiden commitment and state
  explicitly that the entitlement is single-use.
- Treat commitment as reserving one exact tournament. It does not itself prove
  participation or consume the entitlement.
- Hold unresolved, incomplete, stale or low-confidence evidence and preserve ME
  for weaker projected modes.
- Never redirect an existing plan or commitment to another tournament.
- Keep the review read-only and non-actionable pending Gates C and D,
  authenticated persistence and owner acknowledgement.

## 2026-07-23 — Phase 5 Maiden entitlement lifecycle

- Project Maiden inventory from the latest imported historical snapshot through
  explicit, reasoned and sequential manual lifecycle events.
- Keep eligible, planned, committed and consumed states distinct. Planning,
  commitment, release and consumption must retain the same tournament identity.
- Reject manual overlays that predate the imported snapshot cutoff.
- Do not plan from unknown, invalid or ineligible snapshot evidence and do not
  silently restore a consumed entitlement.
- Keep data cutoff, import time and freshness separately auditable.
- Treat the lifecycle as state evidence only; it cannot recommend or execute a
  Maiden entry before Gate D.

## 2026-07-23 — Phase 5 whole-vault Maiden allocation

- Allocate review candidates across the entire Vault with one entitlement per
  core and explicit bracket capacity.
- Maximise the total configured projected value rather than using a
  core-by-core greedy choice.
- Exclude `preserve ME`, held, stale, incomplete, uncertain-bracket and
  unavailable-entitlement candidates.
- Treat all assignments as provisional historical-review output. Do not infer
  live occupancy, mutate ME inventory, commit a core or execute an entry.
- Require Gates C and D plus live-field confirmation before activation.

## 2026-07-23 — Phase 6 breeding pair rules

- Combine confirmed family restrictions with selected-parent availability,
  supplied splice-capacity evidence and supplied breeding-cycle state.
- Do not invent a global splice maximum. Preserve available, exhausted and
  unknown states with the recorded remaining count.
- Derive offspring class from the confirmed matrix, element from the
  lower-ranked parent and F-number from the uncapped parent sum.
- Fail closed on incomplete lineage, unknown parent state, stale evidence or
  unresolved cycles.
- Predict no offspring quality and make no inherited-star claim. Keep all
  recommendations and execution disabled pending Gate E.

## 2026-07-23 — Phase 6 breeding fee calculation

- Preserve base and Arena fees as exact source components and exact per-asset
  totals.
- Keep BGC and USD separate. The USD 1 = BGC 1 owner reference may be shown
  only as a reference equivalent and never as a cash transaction.
- Require exact Arena listing provenance, freshness and expiry. Unknown,
  ageing, stale or expired fee evidence fails closed.
- Require live confirmation and keep recommendation and execution disabled
  pending Gate E.

## 2026-07-23 — Phase 6 breeding star features

- Preserve direct-parent and lineage Gold, Blue and strong-field star evidence as
  exact numerator/denominator features by mode and exact distance.
- Exclude stale, unknown, incomplete, wrong-cell and post-breeding feature
  evidence from chronological research.
- Compare lineage profiles only with population benchmarks whose cutoff predates
  breeding, and require a configured minimum opportunity denominator before
  recording an outlier count.
- Keep zero opportunities distinct from a zero rate and retain `Data current
through` separately from `Last imported`.
- Do not describe star propensity as inherited and do not predict or recommend
  offspring quality before chronological Gate E evidence.

## 2026-07-23 — Phase 6 parent–offspring research dataset

- Build research evidence by exact mode and distance with parent feature cutoffs
  strictly before breeding and offspring outcomes strictly afterwards.
- Partition chronologically by breeding time and deduplicate authoritative
  offspring event IDs across observations.
- Preserve explicit Gold/Blue counts and eligibility; incomplete star evidence
  is excluded rather than converted to negative evidence.
- Make no inherited-star, predictive-lift, exceptional-offspring probability or
  pairing recommendation claim before Gate E.

## 2026-07-23 — Phase 6 offspring outcome distribution

- Represent weaker, comparable, stronger and exceptional offspring outcomes as
  one exact 10,000-basis-point distribution with explicit uncertainty bounds.
- Hold stale, unknown, under-sampled or unsupported calibration evidence rather
  than emitting an unqualified probability.
- Permit star-enhanced distributions only where incremental chronological lift
  is supported; otherwise retain a time-only model or hold the result.
- Keep imported cutoff, import completion, prediction time and expected breeding
  time separately auditable.
- Vault saturation cannot reduce the exceptional tail. This contract does not
  rank or recommend pairings and cannot pass Gate E from synthetic evidence.

## 2026-07-23 — Phase 6 breeding pair ranking

- Always expose highest exceptional-offspring upside, best vault-gap
  improvement and best balanced pairing as separate rankings.
- The elite-upside order uses exceptional and broader quality probabilities
  only; existing vault saturation cannot demote a pairing in that view.
- The vault-gap view remains independent, while the balanced view uses explicit
  integer basis-point weights and auditable exact arithmetic.
- Hold stale, unavailable, rule-unresolved, uncalibrated or unsupported
  star-enhanced evidence rather than forcing a rank.
- Ranking remains experimental and cannot authorise breeding or pass Gate E.

## 2026-07-23 — Phase 6 historical Arena scanning

- Scan only the selected accepted Current Arena snapshot; newer quarantined or
  rolled-back attempts do not replace it.
- Require exact source-core identity and preserve exact USD price, splice
  capacity and expiry without name inference.
- Describe every projected listing as historical and require live confirmation.
- Infer no completed breeding, income or operating P/L from an Arena listing.

## 2026-07-23 — Phase 6 breeding economic evidence

- Create breeding-economic posting proposals only from an authoritative
  transaction export or a reasoned manual confirmation of completed activity.
- Never infer a completed splice, income or operating profit from an arena
  listing.
- Keep DNA, external-owner, BGC, earned-fee and refund categories explicit and
  preserve exact original-asset amounts without combining currencies.
- Hold failed, pending and unknown activity without postings; refunded evidence
  may contain only confirmed credit refunds.
- The contract is review-only and cannot mutate the ledger or initiate wallet
  or game transactions.

## 2026-07-23 — Phase 6 offspring cost basis

- Permit an optional offspring cost-basis assignment only for confirmed actual
  pairing costs from a completed breeding event that produced a confirmed owned
  offspring.
- Keep DNA, external-owner and BGC costs in their original assets and preserve
  exact amounts.
- Link each refund to an included cost in the same asset, reject over-refunds,
  and prevent one transaction from being assigned twice.
- Hold proposed, reversed, missing, duplicate or unresolved evidence rather
  than creating a partial automatic assignment.
- Never infer market value, combine BGC with cash/crypto or calculate a realised
  gain from this assignment.

## 2026-07-23 — Phase 6 chronological breeding lift evaluation

- Compare a time-plus-star candidate with both time-only and lineage baselines
  on identical chronological holdout rows.
- Require feature cutoffs and prediction creation to precede or occur no later
  than breeding, and require authoritative outcomes to follow breeding.
- Exclude incomplete star features from all three model comparisons rather than
  changing the evaluation population between models.
- Report Brier and calibration evidence by exact mode and distance, with
  configured minimum sample and improvement thresholds.
- A supported cell is only a Gate E review candidate. Synthetic evaluation
  cannot establish predictive lift, inherited star propensity or a breeding
  recommendation.

## 2026-07-23 — Phase 7 Vault role and depth analysis

- Measure Vault depth by exact strategic role, mode and distance; do not merge
  Bike, Car and Horse or different exact distances.
- Count only supported evidence meeting an explicit credible-strength threshold.
  Unresolved roles remain visible but do not manufacture depth.
- Raise a redundancy review only when every supported role for a core has the
  configured number of credible alternatives.
- Protect unique roles, Maiden reserves, lineage anchors and exceptional-upside
  evidence regardless of category saturation.
- Treat duplicate coverage as context rather than a sell or burn conclusion.
  This analysis remains non-actionable and cannot mutate the Vault.

## 2026-07-23 — Phase 7 lifecycle evidence protection

- Evaluate lifecycle evidence only for cores confirmed in the active Vault;
  inactive cores remain historical and cannot receive an active recommendation.
- Permanently prohibit burning Genesis cores.
- Protect eligible or unresolved Maiden, Discovery, racing, breeding and
  lineage value before considering sale or burn.
- Hold stale, unknown or incomplete evidence rather than converting missing
  information into a negative conclusion.
- Preserve no-star and Gold-ineligible absence as supporting context only. They
  can never cause a burn or disposal conclusion without independent non-star
  evidence.
- Keep this projection non-mutating and review-only. It cannot sell, burn,
  change ownership, record BGC or post ledger activity.

## 2026-07-23 — Phase 7 lifecycle action ranking

- Compare race, discover, reserve-Maiden, breed, hold, sell and burn using
  explicit audited evidence for every active core.
- Preserve equal scores as ties and return insufficient evidence rather than
  silently resolving the tie through display order.
- Hold stale, incomplete or protection-blocked evidence before action ranking.
- Require confirmed ME, a viable Discovery path and confirmed market evidence
  for their respective strategic actions.
- Keep Genesis burn forbidden and require independent non-star negative evidence
  before a spliced core can enter burn review.
- Keep sell and burn review-only. The ranking cannot execute an action, mutate
  source facts, record a burn credit or post ledger activity.

## 2026-07-23 — Phase 7 core-sale evidence

- Recognise a core sale only from confirmed completed evidence and confirmed
  active ownership at the sale time; strategic advice is never execution proof.
- Preserve exact proceeds and selling fees by original asset.
- Calculate realised result only with known same-asset cost basis and fees.
- Keep proceeds visible while marking gain/loss unavailable when cost basis is
  missing, and never infer an unsold or sold core's market value.
- Produce review postings only; do not list, transfer, sell, mutate ownership or
  post a hosted ledger entry.

## 2026-07-23 — Phase 7 core-burn event

- Permanently reject Genesis burns.
- Recognise an irreversible spliced-core burn only from confirmed completed
  evidence and confirmed active ownership at the event time.
- Retain every burnt core in historical lineage and propose active-Vault removal
  only for review; never mutate ownership automatically.
- Keep strategic advice, actual burn execution and any later BGC credit as
  separate evidence.
- Do not predict burn credit, execute a burn or post a ledger transaction.

## 2026-07-23 — Phase 7 burn-credit reconciliation

- Keep strategic burn advice, confirmed burn execution and actual BGC credit as
  three separate evidence boundaries.
- Propose a credit posting only when one confirmed positive BGC record explicitly
  references the same confirmed burn and core after the burn time.
- Keep core/date candidates, mismatches, provisional records and multiple direct
  credits review-required; never auto-exclude a candidate.
- A missing credit remains missing and no burn-credit amount is predicted.
- Do not mutate the burn event or post a hosted ledger entry.

## 2026-07-23 — Phase 8 Open Race field input

- Treat Stage A race parameters and already-entered opponents as manually
  supplied current-field facts.
- Require the entered-opponent count plus available gates to equal the stated
  gate count.
- Hold unresolved identities, uncertain restrictions and stale or unknown
  historical evidence for review.
- Preserve exact entry-fee text and keep it separate from selection quality.
- Keep imported profile freshness and manual capture time distinct.
- Make current-race Gold and Blue stars structurally unavailable while the field
  is forming. The contract cannot fetch game state, reserve a gate or enter a
  race.

## 2026-07-23 — Phase 8 Open Race eligibility

- Filter only confirmed active owned and manually available cores.
- Apply confirmed class, element, F-number and Maiden restrictions without
  guessing missing attributes or uncertain game rules.
- Keep unresolved ownership, attributes, availability and ME evidence
  review-required rather than eligible.
- Hold otherwise compliant cores when the rule set is uncertain or Vault
  freshness is stale or unknown.
- Keep eligibility separate from performance ranking and current-race stars.
  The contract cannot mutate ownership, ME or race state.

## 2026-07-23 — Phase 8 Open Race pre-entry ranking

- Rank confirmed eligible candidates from matching historical mode and exact
  distance time profiles while the field is forming.
- Keep lower elapsed time primary and historical Gold/Blue profiles supporting
  only; stars cannot change the time rank.
- Preserve the minimum-10 sample boundary and material ties rather than issuing
  a false winner.
- Hold stale evidence, unresolved opponents and missing exact-distance
  histories.
- Disclose partial historical star coverage without allowing it to block or
  change a sound time-led rank.
- Raise an avoid signal only when the best candidate's optimistic time is slower
  than the strongest opponent's conservative time.
- Keep all output provisional and non-actionable before Gate C. Current-race
  stars, post-lock switching and race entry are structurally forbidden.

## 2026-07-23 — Phase 8 Open Race field lock

- Permit Stage B only after every gate is filled, the user confirms the
  committed owned core and the game has set the race to run.
- Preserve the complete entered field, the prior ranking identity, the
  provisional leader and the user's actual selection without rewriting any
  pre-entry evidence.
- Do not require an unselected provisional leader to appear in the locked field.
- Allow a user-selected alternative or an insufficient-evidence entry to be
  recorded with an explicit warning rather than inventing a recommendation.
- Reject current-race stars and race outcomes at the lock transition.
- After lock, prohibit core switching, replacement recommendations and race
  entry; only optional observation may follow.

## 2026-07-23 — Phase 8 Open Race star observation

- Record revealed Gold and Blue only after the complete field is locked and set
  to run.
- Preserve assigned, not-assigned and not-observed states separately; preserve
  Gold not applicable at three gates or fewer.
- Retain any manually claimed ineligible Gold as an anomaly requiring review.
- Keep manual pre-run observations separate from authoritative imported history
  and pending later reconciliation.
- Do not treat the observation as a completed race, predictive success or reason
  to switch the committed core.

## 2026-07-23 — Phase 8 Open Race star comparison

- Compare revealed post-lock stars only with the frozen pre-entry ranking and
  the core the user actually committed.
- Preserve the provisional leader even where the user selected an alternative,
  and support no resolved leader without inventing one.
- Distinguish a provisional leader that was not entered from an entered core
  that received neither revealed star.
- Hold incomplete, ineligible-Gold and otherwise review-required observations
  from a clean diagnostic conclusion.
- Do not rerank candidates, issue replacement advice, declare prediction
  success or treat revealed pre-run stars as a completed outcome.

## 2026-07-23 — Phase 9 Open Race holdout evaluation

- Evaluate only frozen pre-entry decisions whose feature and historical-data
  cutoffs do not follow the decision, and whose decision strictly precedes lock
  and outcome evidence.
- Require current-race stars to remain unavailable at selection time.
- Compare the model with a separately versioned simple baseline using
  competitive outcomes, best-eligible selection and elapsed-time regret.
- Exclude incomplete outcome evidence, disclose stale inputs and keep mode and
  exact distance separate.
- Treat synthetic results as non-dispositive evidence that cannot self-accept
  Gate C or enable actionable Open Race recommendations.

## 2026-07-23 — Phase 9 field-relative star validation

- Validate strong-field star and weak-field eligible no-star evidence only when
  field quality and all analytical features predate the event.
- Distinguish a star assigned to another core from an event where no star was
  assigned; only the former is an assignment-opportunity comparison.
- Exclude Gold evidence at three gates or fewer while leaving Blue independent.
- Keep mode and exact distance separate, require minimum samples on both sides
  and exclude incomplete source evidence.
- Report associations only. No-star evidence cannot independently stop
  Discovery, recommend burn, self-accept Gate C or enable another action.

## 2026-07-23 — Phase 9 Gold and Blue conversion diagnostics

- Measure Gold top-three and Blue win/top-three conversion only from complete
  event evidence whose star observation predates the result.
- Exclude all one- to three-gate events from Gold conversion and retain any
  ineligible Gold assignment as an anomaly.
- Keep not-assigned, partial and invalid star evidence separate from failed
  conversion.
- Report exact denominators by mode, distance, gate count and model era.
- Keep conversion descriptive and post-race only; it cannot become a pre-race
  feature, self-accept Gate C or enable an actionable recommendation.

## 2026-07-24 — Phase 9 prediction calibration

- Compare candidate and simple-baseline probabilities on identical
  chronological holdout cases.
- Require every prediction to predate its outcome and reject unpaired or
  outcome-inconsistent evidence.
- Use exact basis-point arithmetic for Brier score, calibration bins and
  expected calibration error.
- Keep synthetic verification separate from real historical holdout evidence.
- A calibration report always remains Gate C review evidence and cannot
  self-authorise analytical recommendations.

## 2026-07-24 — Phase 9 snapshot freshness validation

- Keep historical coverage, import completion and aggregate refresh timestamps
  separate.
- Calculate freshness from `Data current through`, never from import time.
- Preserve not-imported and unknown-coverage states rather than inventing a
  current date.
- Use configurable current, ageing and stale thresholds with exact boundary
  behaviour.
- Freshness may lower confidence or require review but cannot alter accepted
  historical facts or create a live-state claim.

## 2026-07-24 — Phase 9 historical-snapshot presentation audit

- Require historical-snapshot, data-current-through, last-imported and
  freshness labels on imported analytical surfaces.
- Reject affirmative claims that periodic imported opponents, fields, Arena
  listings, Vault state or recommendations are live, real-time or up to date.
- Permit explicit negative disclosures explaining that the application is not
  live.
- Require Open Race to distinguish manually entered current-field information
  from imported historical evidence.
- A wording audit cannot establish analytical correctness, live integration,
  Production approval or Gate C acceptance.

## 2026-07-24 — Phase 9 star-algorithm era detection

- Compare only adjacent, non-overlapping periods within the same mode and exact distance.
- Preserve assignment-frequency and outcome-conversion shifts as separate basis-point comparisons with explicit numerators, denominators and policy thresholds.
- Treat partial periods or inadequate assignment/outcome samples as insufficient evidence.
- A material shift is a review candidate only; it cannot confirm an algorithm change, infer its cause or automatically establish a model era.
- Synthetic validation cannot accept Gate C or establish real analytical stability.

## 2026-07-24 — Phase 9 import recovery validation

- Audit recovery evidence without executing rollback, source deletion or Production mutation.
- Require exactly one active accepted batch and keep a newer quarantined attempt isolated from accepted facts and freshness.
- Permit only a reasoned rollback to a prior accepted same-owner/source version while retaining batch and contribution provenance.
- Require an exact replay to resolve the existing version with zero new contributions.
- Require a new aggregate refresh after recovered facts change; never carry forward an obsolete completion state.
- Synthetic validation cannot accept Gate B.

## 2026-07-24 — Phase 9 economic reconciliation audit

- Recalculate operating totals with exact decimal arithmetic and compare them by original asset and asset kind.
- Keep BGC separate from cash and crypto, prohibit silent combined-asset totals and exclude non-operating movements from P/L.
- Retain invalid duplicate links, unlinked manual payouts, unresolved records, missing sale cost basis and incomplete conversion coverage as explicit issues.
- Reject a complete-status claim whenever material classification, reconciliation, payout, conversion or cost-basis coverage remains unresolved.
- The audit is read-only, cannot mutate the ledger and cannot establish dependable totals or accept Gate C from synthetic evidence.

## 2026-07-24 — Phase 9 large-history capacity audit

- Require representative sanitized or private hosted evidence at the expected multi-million-row scale before capacity can be verified.
- Require routine requests to use compact precomputed aggregates and scan zero raw race-history rows.
- Keep import and aggregate refresh work off request paths and process it in bounded batches.
- Compare repeated exact-head p95 latency and peak memory measurements with explicit budgets.
- Treat missing measurements, incomplete background runs and inadequate repetitions as review-required.
- Block private logging, provider changes and Production mutation within the capacity-validation scope.
- Synthetic tests validate the audit contract only and cannot establish Production readiness or accept Gate F.

## 2026-07-24 — Phase 9 security and privacy audit

- Require one explicit evidence state for every mandatory authentication, isolation, storage, logging, repository, indexing and dependency/configuration control.
- Treat unknown evidence as review-required and failed evidence as blocking.
- Require an evidence note for every verified or failed control and reject missing or duplicate controls.
- Keep Production readiness, public exposure and secret collection structurally false in the audit output.
- Block any request to mutate Production, expose routes, collect secrets or enable a paid service within this audit.
- Keep Gate F client-only; synthetic tests validate deterministic audit behaviour only.

## 2026-07-24 — Phase 9 private Production-readiness assessment

- Aggregate Gates A–E, exact-head CI, representative private import, recovery, performance, security, accessibility, migration and known-limitation evidence before Gate F review.
- Treat missing evidence as review-required and failed evidence as blocking.
- Require Production to remain fail-closed with no custom domain, public routes, full private dataset or recurring paid infrastructure during assessment.
- Keep Gate F client-only and require explicit owner approval.
- Record approval evidence without authorising, executing or permitting a Production mutation.
- Synthetic tests validate the readiness contract only and cannot establish that the actual application is Production-ready.

## 2026-07-24 — Lazy owner-scoped Neon import read repository

- Add the Neon serverless driver as the approved PostgreSQL transport without provisioning a database or configuring a secret.
- Keep provider import and query-function creation lazy. The Imports route may construct the repository during a build, but no database client or network request is created until an authorised owner read occurs.
- Require both `DATABASE_URL` and the server-only internal `DNA_DATABASE_OWNER_ID`; missing values preserve the explicit not-configured state.
- Within one bounded read-only repeatable-read transaction, set `app.owner_id`, verify the internal owner-to-Clerk mapping and rely on the existing forced row-level-security policies.
- Read compact import manifests, versions, aggregate timestamps and count-only review summaries only. Routine route reads scan no raw Race Merge history or private source values.
- Return the 200 most recent supported batches plus every active source version so quarantined attempts cannot hide the accepted dataset.
- Validate PostgreSQL timestamps, Booleans, `bigint` counts, source/status enums and warning payloads before they enter the domain projection; unsupported or unsafe values fail closed.
- Keep Clerk authentication, Preview provider configuration, the first persistent private import, uploads, background processing, PostgreSQL execution evidence and Production separately gated.
