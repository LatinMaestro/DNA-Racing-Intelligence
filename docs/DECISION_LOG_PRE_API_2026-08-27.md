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
- Preserve exact elapsed-time and economic source values for audit. Elapsed-time seconds are owner-confirmed and may be normalized to integer milliseconds and metres-per-second speed; race-derived economic transactions remain subject to their separate validated semantics.
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
- Accept performance observations after converting the owner-confirmed source seconds to positive integer milliseconds using `seconds * 1000`; reject non-integral millisecond results rather than guessing or silently rounding.
- Key every profile by authoritative core ID, mode and exact distance. Bike, Car and Horse evidence and different exact distances never merge.
- Keep fewer than 10 races hypothesis-only and label 10 or more minimally analytical rather than proven.
- Expose best, median, mean, trimmed mean, population standard deviation, interquartile range and derived speed with transparent formulas and higher-speed/lower-time direction.
- Link Gold/Blue evidence only from the matching core, mode and exact-distance profile while preserving eligibility, numerators, denominators and anomaly coverage.
- Keep every profile experimental until Gate C chronological holdout, baseline and calibration evidence passes. Synthetic verification cannot establish analytical success.
- Expose the historical data cutoff and freshness state; never describe the result as live.

## 2026-07-23 — Race distance unit

- The repository owner confirms that race distance values are measured in metres.
- Phase 2 derived speed is labelled in metres per second because distance is metres and elapsed time is owner-confirmed seconds.

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
- Project ownership edits and Maiden overrides on one effective-time timeline. Apply ownership first at equal timestamps, bind overrides only while the Core is active, and never validate an override retroactively from a later ownership change.

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

## 2026-07-24 — Lazy owner-scoped Neon import read repository

- Add the Neon serverless driver as the approved PostgreSQL transport without provisioning a database or configuring a secret.
- Keep provider import and query-function creation lazy. The Imports route may construct the repository during a build, but no database client or network request is created until an authorised owner read occurs.
- Require both `DATABASE_URL` and the server-only internal `DNA_DATABASE_OWNER_ID`; missing values preserve the explicit not-configured state.
- Within one bounded read-only repeatable-read transaction, set `app.owner_id`, verify the internal owner-to-Clerk mapping and rely on the existing forced row-level-security policies.
- Read compact import manifests, versions, aggregate timestamps and count-only review summaries only. Routine route reads scan no raw Race Merge history or private source values.
- Return the 200 most recent supported batches plus every active source version so quarantined attempts cannot hide the accepted dataset.
- Validate PostgreSQL timestamps, Booleans, `bigint` counts, source/status enums and warning payloads before they enter the domain projection; unsupported or unsafe values fail closed.
- Keep Clerk authentication, Preview provider configuration, the first persistent private import, uploads, background processing, PostgreSQL execution evidence and Production separately gated.

## 2026-07-24 — Fail-closed Clerk owner-session wiring

- Add the Clerk Next.js SDK as the accepted request-authentication transport without provisioning an account, adding a secret or enabling Preview.
- Preserve the deployment gate before Clerk middleware. Disabled Preview and Production requests remain non-indexable 404 responses even when Clerk is unconfigured.
- Require both the publishable and secret Clerk keys before requesting authentication evidence. Missing configuration remains unavailable, partial configuration fails closed and no provider call occurs during `next build`.
- Read only the server-side Clerk user ID from the authenticated request and independently require it to match `AUTHORIZED_CLERK_USER_ID` at the import-service boundary before any persistence query.
- A signed-out request remains disconnected, a signed-in non-owner is denied before persistence and malformed session evidence fails closed.
- Render the Clerk provider only when its browser-safe publishable key exists; repository-only validation therefore remains possible without secrets or network initialization.
- Keep sign-in UI, account provisioning, Preview secrets, real provider verification, uploads, background processing and Production separately gated.

## 2026-07-24 — Guarded import confirmation and dispatch

- Treat the persisted owner-scoped preview and its SHA-256 fingerprint as the
  activation authority; never trust a browser-supplied preview body.
- Require exact owner identity, explicit confirmation, private raw-object
  attestation, an approved-capacity decision, durable persistence and an
  idempotent background queue before activation can be scheduled.
- Reserve the update session and stable dispatch ID before enqueueing work.
  Repeated confirmation returns the existing queued reservation rather than
  creating another job.
- Record enqueue failure as retryable dispatch evidence without changing the
  active source version. Dataset activation remains a later background
  transaction after validation succeeds.
- Keep all providers unavailable by default. Do not provision services, enable
  uploads, expose routes or change Preview or Production in this slice.

## 2026-07-24 — Background import claim and lease

- Resolve every queue delivery from a durable dispatch ID inside the private
  persistence boundary; do not trust owner or preview details supplied by a
  queue payload.
- Atomically claim one bounded worker lease before processing. Missing,
  completed and concurrently leased deliveries cannot invoke the processor.
- Bind the prepared result to the claimed owner, session, dispatch and preview
  fingerprint, then activate it only through an owner-scoped persistence
  transaction.
- Record processor failure without activating prepared data. Keep the prior
  accepted source version current and allow a later delivery to retry safely.
- Mark aggregate refresh pending whenever accepted facts change, and do not
  present recommendations as refreshed until that later work completes.
- Keep the worker, queue, raw-object streaming, provider persistence and real
  data processing unconfigured in this contract-only slice.

## 2026-07-24 — Private raw-object streaming integrity

- Resolve every private object reference, source family, expected byte length
  and SHA-256 checksum from durable owner-scoped preview evidence; never trust
  those values from a queue delivery or browser request.
- Require private storage metadata to match the persisted byte length before
  prepared staging begins.
- Stream sequential bounded byte chunks with backpressure, incremental SHA-256
  verification and explicit per-chunk and total capacity limits. Never buffer a
  multi-million-row source object in application memory.
- Permit a transactional staging sink to commit only after exact streamed byte
  length and checksum verification. Abort prepared staging on truncation,
  extension, corruption, oversized chunks, malformed chunks or staging failure.
- Keep active source versions, freshness and recommendations unchanged until
  the separately controlled background activation transaction succeeds.
- Preserve the original object in private raw storage. Expose only internal
  identities, counts, checksums, sizes and stable failure codes to routine
  processing; filenames, rows and source values remain outside Git and logs.
- Keep the storage provider, credentials, upload route, persistent processing
  and Preview/Production activation unconfigured in this provider-neutral slice.

## 2026-07-24 — Source-version-bound aggregate refresh

- Resolve every refresh from one durable internal ID and owner-scoped
  persistence. Queue payloads cannot supply owner, update-session or source
  version evidence.
- Atomically claim one bounded lease and keep missing, completed or concurrently
  leased refreshes outside analytical processing.
- Bind every prepared aggregate set to a SHA-256 fingerprint of the exact active
  source-version set used for computation.
- Publish a prepared set only through an owner-scoped transaction that verifies
  the same source-version fingerprint is still active. A newer accepted import
  supersedes the old refresh instead of allowing stale aggregate publication.
- Keep the last completely published aggregate set available to routine reads.
  Partly prepared or superseded results cannot advance aggregate completion,
  freshness or recommendation readiness.
- Record computation and publication failures as retryable evidence without
  claiming completion or exposing private analytical values in routine output.
- Keep repository SQL, queue/worker providers, private-data execution and
  Preview/Production activation outside this provider-neutral service slice.

## 2026-07-24 — Import completion and recoverable rollback

- Build one deterministic completion report per update session with accepted,
  duplicate, quarantined, warning, identity-review and reconciliation-review
  counts by source.
- Validate and canonicalize every runtime identifier, discriminant, Boolean,
  timestamp and count before completion evidence can affect readiness.
- Reject unsafe per-source classification sums and cross-source total overflow;
  normalized batch IDs define uniqueness and are the only IDs returned.
- Keep recommendation readiness partial until the exact accepted source-version
  set has a completely published aggregate refresh and no material review work
  remains.
- Treat exact replay as no accepted change: it creates no new rollback boundary
  and needs no aggregate refresh.
- Require exact owner identity, literal confirmation, a printable meaningful
  reason, a genuine timestamp and an idempotency key before requesting rollback.
- Validate every repository outcome, disposition, source family and returned ID;
  malformed provider evidence fails closed rather than becoming a result.
- Execute rollback as one owner/source-scoped persistence transaction that
  restores only a prior accepted version, retains raw and contribution
  provenance, and creates a new aggregate-refresh request.
- Never carry forward old aggregate completion after rollback, delete source
  evidence, mutate Production or expose private details through routine output.

## 2026-07-24 — Owner-scoped Vault read workspace

- Replace the Vault placeholder with an authenticated dynamic Server Component
  and a provider-neutral application service.
- Require the authenticated Clerk owner to match the server-side allowlist
  before any Vault persistence read.
- Validate and canonicalize repository objects, arrays, identifiers and
  discriminants before deterministic domain projection; malformed provider
  evidence fails closed rather than becoming an empty Vault.
- Project the accepted snapshot and auditable manual overlays only through the
  existing deterministic durable-ID registry. Proposed matches cannot create
  ownership, personal economics or recommendations.
- Keep ownership and Maiden eligibility separate, retain missing Core Details
  as unavailable evidence and show data-current-through, import time and
  freshness independently.
- Keep all owner mutations, provider initialization, private snapshot execution
  and Preview/Production activation unavailable in this read-only slice.

## 2026-07-24 — Owner-scoped Core Intelligence read workspace

- Replace the Core Intelligence route's hardcoded empty projection with an
  authenticated dynamic Server Component and provider-neutral application
  service.
- Require the authenticated Clerk owner to match the server-side allowlist
  before any compact-profile persistence read.
- Read only materialized owner-scoped profiles and the latest accepted import
  timestamp on routine requests; do not scan raw Race Merge history.
- Canonicalize runtime repository shapes, identifiers and timestamps; reject
  unsafe or inconsistent performance metrics, nested star evidence and
  duplicate core/mode/exact-distance projections.
- Derive freshness from accepted current-through evidence and server time on
  every read rather than trusting a stored label.
- Keep all evidence historical and experimental, preserve explicit star
  denominators and retain the less-than-10-race hypothesis-only boundary.
- Keep provider initialization, private-data execution, recommendations and
  Preview/Production activation unavailable in this read-only slice.

## 2026-07-24 — Private chronological evidence contract

- Keep all private exports, exact aggregates, model scores, identities, economic
  values and derived private results outside Git; repository fixtures remain
  synthetic.
- Bind a hosted assessment to a canonical non-secret evidence identifier and
  exact lowercase 40-character source head without storing the report payload.
- Require externally ordered evidence, strict pre-event feature cutoffs,
  prediction before same-event updates, partial-event outcome exclusion and
  separate mode/exact-metre/gate-count baselines.
- Bind direct-history, historical-star and lineage conclusions to their own
  eligible case counts. Positive lift is review-only; zero/negative lift cannot
  be promoted.
- Validate runtime shapes, Booleans, discriminants, safe counts, overflow,
  signed integer millionths, positive memory evidence and BGC exception counts
  fail-closed.
- Keep breeding blocked without breeding-time evidence and Maiden blocked
  without point-in-time entitlement history. Era candidates cannot establish
  causality or automatic boundaries.
- Gate C and Gate E remain unaccepted; recommendations and Production mutation
  remain disabled for every assessment result.

## 2026-08-01 — Owner-scoped Vault Performance read workspace

- Recompose the focused Vault Performance summary and read-workspace evidence from
  queue source head `892f30c17574216731ec5356dad10a75eb8f242e` onto verified
  `main` rather than merging its 130-commit staged ancestry.
- Include the missing deterministic summary prerequisite and its synthetic tests
  with the workspace so current `main` remains independently buildable.
- Require authenticated Clerk owner identity to match the server-side allowlist
  before the compact summary repository can be queried.
- Validate canonical periods, timestamps, safe counts, exact decimals, asset
  identities, BGC separation, completeness flags and duplicate assets at the
  application boundary.
- Derive freshness from the accepted data-current-through timestamp and server
  time on every read, update freshness warnings deterministically and reject
  evidence whose cutoff follows its import.
- Render historical original-asset totals only, keep BGC and non-operating
  movements separate, preserve unavailable cost-basis results and never claim a
  live wallet balance, combined-asset total or complete lifetime profit.
- Keep the repository adapter unavailable. Manual entries, provider
  initialization, private-data execution, Preview and Production remain disabled.

## 2026-08-01 — Owner-scoped Discovery read workspace

- Recompose the focused Discovery evidence from queue source head
  `f28f37a97e4bc93f862959d0e1eded9c7b2e69c8` onto verified `main`
  `53460e97de5aba1299651624af09ec37a27745b2` rather than merging staged
  ancestry or its embedded queue ledger.
- Include the missing deterministic probe-plan prerequisite and synthetic tests
  so current `main` remains independently buildable.
- Require authenticated Clerk owner identity to match the server-side allowlist
  before the compact candidate repository can be queried.
- Preserve separate Bike, Car and Horse evidence at exact distances in metres,
  the ten-race minimum boundary, direct-evidence priority, resolved-lineage
  hypotheses and Maiden commitment warnings.
- Derive freshness from canonical accepted cutoffs and server time instead of
  trusting a persisted label. Defer evidence without an accepted import and
  reject future imports plus future or post-import cutoffs.
- Keep every candidate experimental and non-actionable. Automatic race entry,
  automatic stopping, provider initialization, private-data execution, Preview
  and Production remain disabled.

## 2026-08-01 — Owner-scoped Tournament read workspace

- Recompose queue order 16 from exact source head
  `e5decdd4dc616ae06d20196bb847645724da14d8` onto verified `main`
  `fb1f171e0bedea48b08a010d219bb5d6e2449ad6`; do not merge its staged
  ancestry, queue ledger or rehearsal descendants.
- Include the missing deterministic tournament-ranking prerequisite and
  synthetic tests so current `main` remains independently buildable.
- Preserve separate labelled leaderboard groups and group-scoped ranks,
  including legitimate ties; render the tournament split and group labels.
- Bind every candidate to the exact tournament configuration and
  candidate-snapshot versions. Reject version drift and inconsistent ID-to-label
  mappings.
- Derive freshness from the accepted data cutoff and server time at read time.
  Reject future imports, future cutoffs and cutoffs that follow their import,
  with exact 3/4/7/8-day boundary coverage.
- Preserve the configurable qualification metric as the sole ordering authority,
  the 50% gate rule as a cap rather than a target, and Maiden eligibility for
  the strongest credible mode-specific opportunity.
- Keep every result historical, experimental and non-actionable. Provider
  initialization, private-data execution, automatic entry, Preview and
  Production remain disabled.

## 2026-08-01 — Owner-scoped Maiden read workspace

- Recompose queue order 17 from exact source head
  `c9b0004f7086c8a4fb489690d3465a701312596b` onto verified `main`
  `4748f3e21f0eade849fb69d2ceff99ea497c3217`; do not merge its staged
  precursor, queue ledger, rehearsal branches or cumulative descendants.
- Include the missing deterministic whole-Vault allocation prerequisite and
  synthetic tests so current `main` remains independently buildable.
- Require authenticated Clerk owner identity to match the server-side allowlist
  before any compact allocation evidence can be queried.
- Bind tournament/bracket labels, configuration version, candidate-snapshot
  version and time-led projection version end-to-end. Reject drift and
  inconsistent ID-to-label or cross-mode bindings.
- Compare complete Bike, Car and Horse evidence and preserve ME for the strongest
  credible opportunity. Weak or unknown time evidence fails closed; historical
  stars remain supporting context and never drive allocation.
- Derive freshness from canonical accepted cutoffs and server time. Defer
  candidates without an accepted import and reject future imports, future
  cutoffs and post-import evidence, with exact 3/4/7/8-day tests.
- Keep current Vault ME evidence explicitly non-historical, and keep planned,
  committed and consumed lifecycle states unavailable for allocation.
- Keep every result historical, experimental and non-actionable. Entitlement
  mutation, provider initialization, private-data execution, automatic entry,
  Preview and Production remain disabled.

## 2026-08-02 — Owner-scoped Breeding read workspace

- Recompose queue order 18 from exact source head
  `c77c30b0169e2835a61c67368901d57ecc7860a9` onto verified `main`
  `8a1bdd208496d44a190bd188b449e85575b6fcc3`; do not merge its staged
  precursor, queue ledger, rehearsal branches or cumulative descendants.
- Include the missing deterministic pair-ranking prerequisite and synthetic
  tests so current `main` remains independently buildable.
- Require authenticated Clerk owner identity to match the server-side allowlist
  before compact ranking evidence can be read.
- Keep elite-upside, Vault-gap and balanced objectives separate. Vault
  saturation cannot demote the elite-upside order.
- Bind confirmed ruleset, candidate-snapshot, chronological-projection and Arena
  snapshot versions. Derive offspring class, lower element and uncapped F-number
  through the confirmed game-rule functions.
- Require cleared family, sex, cycle, lifetime-splice, availability,
  chronological-validation and offspring-distribution evidence. Star features
  require supported incremental holdout lift over a time-only baseline.
- Derive performance and Arena freshness from canonical accepted cutoffs and
  server time. Reject future or post-import evidence and hold stale, expired,
  missing or version-drifted external listings.
- Keep Arena listings historical, non-live and non-economic. Keep every result
  experimental and non-actionable; provider initialization, breeding execution,
  private-data execution, Preview and Production remain disabled.

## 2026-08-02 — Owner-scoped Lifecycle read workspace

- Recompose queue order 19 from exact source head
  `8ce3661b6392dd8dc23f0be207d1c75be892c1ee` onto verified `main`
  `05da45d1f0e581e840b77607154f6299c5aee3cd`; do not merge its staged
  precursor, queue ledger, rehearsal branches or cumulative descendants.
- Include the missing deterministic lifecycle-ranking prerequisite and
  synthetic tests so current `main` remains independently buildable.
- Require authenticated Clerk owner identity to match the server-side allowlist
  before compact ranking evidence can be read.
- Bind configuration, candidate, racing, Discovery, Maiden, breeding, lineage
  and market snapshot versions. Version drift holds every action.
- Derive freshness from canonical accepted cutoffs and server time. Reject
  future or post-import evidence, stale stored labels and rankings not bound to
  the latest accepted import, with exact 3/4/7/8-day tests.
- Preserve unresolved racing, Discovery, Maiden, breeding, lineage and market
  value by holding every action when evidence is partial, stale or protected.
- Apply the confirmed Genesis burn prohibition. No-star evidence cannot create
  burn without explicit independent non-star negatives, and predicted BGC burn
  credit is forbidden in ranking.
- Preserve missing cost basis without inventing sale profit. Keep all results
  historical, experimental and non-actionable; provider initialization,
  private-data execution, game/wallet actions, ledger mutation, Preview and
  Production remain disabled.

## 2026-08-02 — Owner-scoped Open Race read workspace

- Queue order 20 source `agent/open-race-read-workspace` at exact head
  `6254a9a2a409486c4825653a022971f825b7e62f` was recomposed as a focused delta
  onto verified `main` at
  `cfc66c62b131c78c3cb2a51273c98f6473ca942f`; staged ancestry was not merged.
- Open Race Stage A remains a manually captured, owner-scoped review using
  imported historical evidence. Current-race Gold and Blue are rejected at the
  field, opponent, candidate and ranking boundaries and cannot affect the
  pre-entry rank.
- Stage B is available only after the owner-confirmed core and complete field
  are locked. Its Gold/Blue record is diagnostic, pending authoritative Race
  Merge reconciliation and cannot change the frozen ranking, recommend a
  replacement or claim a race outcome.
- Each session is bound to the latest accepted Race Merge import, Vault
  snapshot and historical aggregate versions and to exact per-stage versions,
  identifiers, timestamps, ordered ranking, entered field and observed signals.
- Freshness is derived server-side from canonical accepted cutoffs. Exact
  3-day, 4-day, 7-day and 8-day boundaries are covered; future,
  post-import, non-canonical, stale-version and inconsistent evidence fails
  closed.
- Open Race remains historical, experimental and non-actionable. Gate C,
  mutations, race entry, game or wallet actions, live connectivity, Preview and
  Production remain disabled.

## 2026-08-02 — Owner-scoped Phase 9 readiness workspace

- Queue order 21 source `agent/readiness-read-workspace` at exact head
  `9a9cd34023755ebb8480e4d56f8c36c628a00957` was recomposed as a focused delta
  onto verified `main` at
  `64fdc686824c38f22c96dfc325561a87a5f183d6`; staged ancestry was not merged.
- Readiness evidence is owner-scoped, read-only and non-executable. It can
  report pass, review or block states but cannot enable a provider, public
  route, custom domain, recurring paid infrastructure, Preview or Production.
- Accepted readiness evidence must bind its exact assessment version and
  canonical chronology to the running deployment's exact commit SHA. Branch
  names, stale versions, future evidence, non-canonical timestamps and
  inconsistent publication order fail closed.
- Freshness is derived server-side from the evidence cutoff with exact 3-day,
  4-day, 7-day and 8-day boundary coverage. Ageing and stale readiness evidence
  cannot support a ready state.
- Gates B–E remain unaccepted until every repository and protected private
  evidence criterion passes. Gate F remains owner-only, and even a recorded
  approval cannot make this assessment authorize activation or a Production
  mutation.

## 2026-08-02 — Owner-scoped manual ledger write boundary

- Recompose the staged exact-entry and reversal service together with its
  previously unstated manual-ledger domain prerequisite so the focused delta is
  complete on current `main`.
- Require authenticated Clerk owner equality before validation or repository
  access and keep persistence unavailable by default.
- Resolve asset code, kind and precision from a versioned server-side registry;
  reject caller metadata mismatch, excess precision and registry-version drift.
- Canonicalize entry and reversal timestamps to UTC, reject future evidence and
  preserve exact base-10 amounts without binary floating point.
- Treat a free-text tournament ID as non-authoritative. Tournament totals remain
  ineligible until owner-scoped persistence returns matching acknowledged
  evidence and exact tournament-configuration version.
- Bind every create or reversal to an expected ledger version. Keep exact
  durable-ID replay idempotent and reject changed payloads or stale writes.
- Build reversals only from the immutable accepted original, require its exact
  fingerprint and current registry evidence, and require persistence to enforce
  one reversal per original atomically.
- Preserve separate assets, BGC isolation, transfer exclusion, missing-cost-basis
  warnings and tournament-allocation warnings without claiming completeness.
- Keep forms, provider initialization, wallet actions, private data,
  Preview/Production persistence and Production disabled.

## 2026-08-02 — Owner-scoped manual tournament payout write boundary

- Recompose queue order 23 from exact source head
  `0a5b38f46ab9881f7367a48de94ed62a40659e1e` onto verified `main`
  `e29cbd2b94264c618d9b82f720dd1e39da3458a4`; do not merge staged ancestry,
  queue ledgers, rehearsal branches or cumulative descendants.
- Include the missing deterministic allocation and prize-reconciliation domains
  and synthetic tests so the focused delta is independently buildable.
- Require authenticated Clerk owner equality before economic repository access,
  an owner-acknowledged persisted campaign binding, exact tournament evidence
  and exact configuration version. Free text cannot authorize campaign totals.
- Resolve asset kind and precision from an authoritative versioned server-side
  registry. Reject BGC, caller metadata mismatch and registry drift; preserve
  exact asset separation and allocation conservation.
- Bind reconciliation to the active import-snapshot SHA-256, an independently
  recomputed candidate-set SHA-256 and the complete expected imported
  transaction-identity set.
- Keep imported facts immutable and suspected duplicates included pending a
  reasoned owner decision. A confirmed duplicate excludes only the manual
  payout; a confirmed separate payment remains included.
- Revalidate the campaign, asset registry, stored-state fingerprint, candidate
  evidence and optimistic revision at decision time. Candidate or snapshot drift
  atomically reopens review and restores an included manual aggregate state.
- Require an atomic reopen to return its exact bounded candidate set and
  independently canonicalize and re-hash it before reporting the reopened
  snapshot or candidate evidence.
- Bind stored ledger version, revision and the last operation fingerprint into
  state evidence so exact lost-response retries replay without another write;
  changed or genuinely stale decisions remain blocked.
- Keep persistence unavailable by default. Forms, provider initialization,
  private data, wallet/game actions, Preview writes and Production remain
  disabled.

## 2026-08-02 — Owner-scoped lifecycle economic write boundary

- Recompose queue order 24 from exact source head
  `b04c9423ca2ceb85a110d464624aa37613f4ca56` onto verified `main`
  `98885c094062ff336857993015656de113ab2a33`; do not merge staged ancestry,
  queue ledgers, rehearsal branches or cumulative descendants.
- Include the three unstated sale, burn and burn-credit reconciliation domain
  prerequisites and their synthetic coverage so the focused delta is complete
  on current `main`.
- Require authenticated Clerk owner equality before any repository access and
  keep provider-neutral persistence unavailable by default.
- Canonicalize sale, burn, recorded and BGC-credit timestamps at the service
  boundary and reject future evidence using server-derived time.
- Resolve every sale and credit asset code, kind and precision from an
  authoritative versioned server-side registry. Bind persisted evidence to that
  exact registry version and reject missing, ambiguous, invalid or drifted
  definitions and excess precision.
- Bind each sale, burn or BGC-credit create to the caller's expected lifecycle
  version. Keep exact fingerprint replay idempotent, reject optimistic-version
  drift and fail closed when a durable identity is reused for changed evidence.
- Preserve proceeds and fees in their original assets. Calculate realised sale
  result only when proceeds, fees and acquisition cost share one asset; retain
  proceeds while missing or unlike cost basis leaves gain unavailable.
- Permanently reject Genesis burn evidence. A confirmed non-Genesis burn can
  only propose reviewed Vault removal while historical lineage remains; it
  cannot execute a burn, mutate ownership or predict BGC.
- Accept a BGC credit only as actual positive game-credit evidence linked to one
  durable owner-scoped burn. Verify the stored burn fingerprint and core
  identity; ambiguous, provisional, conflicted, early or multiple credits remain
  review-only.
- Keep forms, provider initialization, ledger mutation, private data,
  wallet/game actions, Preview writes and Production disabled.

## 2026-08-08 — Lifecycle burn-credit replay hardening

- Recompose queue order 25 from exact source head
  `f2dc526861736ce5bfbd4beccc8877801dcc0220` onto verified `main`
  `33dbb7e334eeb8f90e35412b86ec8e0ce5ddabf2`; do not merge its staged
  ancestry, queue ledger, rehearsal branches or cumulative descendants.
- Preserve the newer authoritative asset registry, exact precision, canonical
  timestamp, optimistic lifecycle-version, Genesis prohibition and accounting
  controls already accepted with queue order 24.
- Load an existing owner-scoped burn credit by canonical durable ID before
  reading its referenced burn or sibling credits. Exact lost-response replay
  returns the stored reconciliation and lifecycle version without another
  write or dependency read.
- Bind durable identity to the canonical credit and authoritative asset
  evidence, and independently verify the complete stored reconciliation record.
  Changed input, corrupted stored evidence or invalid lifecycle versions fail
  closed.
- A fresh exact-lock audit exposed new production advisories in transitive
  `postcss` and `nanoid`, plus a new development-only `js-yaml` advisory.
  Pin their patched compatible releases through the existing override boundary;
  keep the inherited development-only `brace-expansion` advisory tracked
  without weakening validation or forcing incompatible transitive majors.
- Keep persistence unavailable by default. Forms, provider initialization,
  ledger mutation, private data, wallet/game actions, Preview writes and
  Production remain disabled.

## 2026-08-08 — Owner-scoped breeding economic write boundary

- Recompose queue order 26 from exact source head
  `5adb71fd47103c830178c93e47eaa006a8071520` onto verified `main`
  `4e3e4c0b7f59c440bb5576a3ce664a7d13ea18f2`; do not merge its staged
  ancestry, queue ledger, rehearsal branches or cumulative descendants.
- Include the deterministic breeding-evidence and offspring-cost-basis domain
  prerequisites and synthetic tests so the focused delta is independently
  buildable.
- Require authenticated Clerk owner equality before repository access and keep
  provider-neutral persistence unavailable by default.
- Resolve asset kind and precision from an authoritative versioned server-side
  registry. Reject missing, ambiguous, invalid or drifted definitions, caller
  metadata mismatch and excess precision.
- Canonicalize timestamps, durable IDs, exact original-asset amounts, references
  and transaction ordering before SHA-256 fingerprinting. Reject future
  evidence using server-derived time.
- Replay exact owner-scoped durable evidence before later classification or
  duplicate queries. Changed payloads fail closed; fresh writes carry an
  expected economic version and atomic version drift requires refresh.
- Persist only completed/refunded transaction evidence and confirmed actual
  offspring cost-basis review records. Arena listings, pending activity,
  incomplete evidence and duplicate transactions remain held.
- Preserve separate original assets and BGC isolation. Never infer completed
  income from an Arena listing, combine assets, assign market value, calculate
  realised gain, or initiate a splice, wallet/game action or ledger mutation.
- Keep adapters, forms, provider initialization, private-data execution,
  Preview writes and Production disabled.

## 2026-08-08 — Guarded private import upload intake

- Recompose queue order 27 from exact source head
  `e2a66de3bfa5ab5e9f6ec84b4cebfdcb167f24b4` onto verified `main`
  `1f7dc7618a087dec236a3f76ec0a286c83233ca9`; do not merge staged
  ancestry, queue ledgers, rehearsal branches or cumulative descendants.
- Require exact authenticated-owner equality before capacity, persistence or
  object-store access and keep all provider capabilities unavailable by default.
- Accept bounded CSV metadata only: safe private filename, normalized content
  type, positive safe byte length, declared source family and lowercase SHA-256.
  The application never receives, proxies or buffers source bytes.
- Preserve the four authoritative source families: Core Details, Current Vault,
  Current Arena and sequential Race Merge. Permit grouped Race Merge candidates
  but only one replacement candidate per non-history source family in a batch.
- Apply the approved capacity gate before durable reservation. Bind the
  idempotency key and ordered canonical file metadata to a SHA-256 request
  fingerprint carried through every reservation state transition; changed
  replay evidence fails closed before any upload target is issued.
- Validate provider-returned disposition, request fingerprint, complete unique
  identity set, PUT method and bounded control-free opaque target tokens.
  Partial or inconsistent target reservations are marked failed without source
  activation, freshness, aggregate or recommendation mutation.
- Upload intake is not preview, confirmation, processing or activation. Keep
  route/action wiring, concrete adapters, private data, Preview execution and
  Production disabled.

## 2026-08-08 — Guarded private import upload completion

- Recompose queue order 28 from exact source head
  `a4b603feb03a09ce0e6d2a4772aac0c530b35baa` onto verified `main`
  `a192e351cd422b76f5bc5fb1220662d4203b0eac`; do not merge staged
  ancestry, queue ledgers, rehearsal branches or cumulative descendants.
- Preserve order 27's capacity-gated, owner-scoped, request-fingerprinted
  direct-upload reservation. Bind the completion claim, exact replay and
  preview dispatch to that same upload-request fingerprint.
- Require canonical, unexpired upload-target evidence before object access.
  Inspect only the exact private owner/batch/file/object identity reserved by
  the repository; reject public, cross-owner or substituted provider metadata.
- Require exact reserved byte length and normalized content type. Compare
  provider SHA-256 when available; when absent, the later bounded preview
  worker must still stream and verify every byte before accepting staged
  evidence.
- Reserve a durable dispatch before queue access. Require the idempotent queue
  acknowledgement to repeat the exact dispatch ID and request fingerprint so
  lost-response retries cannot schedule a second logical preview.
- Completion is not schema acceptance, preview confirmation, processing or
  activation. It cannot advance an active source version, freshness,
  aggregates or recommendations.
- Keep repository, private object-store and queue capabilities unavailable by
  default. Route/action wiring, concrete provider adapters, private data,
  Preview execution and Production remain disabled.

## 2026-08-08 — Lean bounded import preview processing

- Recompose the useful executable portion of queue order 29 from exact source
  `8b8ec9f3b1bc91c84975840fa2708371149af2f4` onto scope-corrected
  `main` `a0ccfdba61114330397748c69873bd70091b7952`.
- Keep only the private import worker needed to claim one queued dispatch,
  validate its durable object manifest, run bounded deterministic preview
  preparation and publish review evidence atomically.
- Bind queue message, lease, completed replay and publication to the exact
  upload-request fingerprint. Require publication acknowledgement to repeat the
  request, manifest and preview identities.
- Enforce the approved total manifest byte boundary before processing. The
  later concrete processor must stream every object through the existing
  bounded SHA-256-verifying raw-object path.
- Blocked previews remain reviewable and non-confirmable. No preview can
  confirm an import, activate a source, alter freshness, refresh aggregates or
  produce an actionable recommendation.
- Keep this as one specific private-import worker rather than a general workflow
  platform. Concrete provider wiring, private data, Preview execution and
  Production remain disabled.

## 2026-08-08 — Lean authenticated private-import owner actions

- Extract only the useful executable portion of source-inventory order 30 from exact head `bf52a3f408551275fca2167fd9fea395988fc2b7` onto `main` `e1f6b5c17c3da6f370d38982dc5901ae45d6a5c3`.
- Resolve the authenticated identity inside each server-only action and never accept a browser-supplied owner ID. Signed-out requests fail closed, non-owner sessions are denied before provider access and authentication-provider failures are sanitized.
- Forward the exact idempotency and upload-request fingerprints into the existing guarded upload-intake and completion services.
- Keep provider wiring, forms, administration, private data, Preview execution and Production disabled. The historical standalone service document and README catalogue entry were omitted as unnecessary for this basic single-owner website.

## 2026-08-08 — Lean private-import Server Actions

- Extract only the useful executable portion of source-inventory order 31 from exact head `e4c077da3a1e5d81371002b9d0d38a369ed27d26` onto `main` `470c870033253030b4e3d03cb12e298a8f990717`.
- Add two server-only request adapters for starting and completing the private import. Each resolves the current Clerk identity inside the request and forwards only validated metadata, idempotency and upload-request fingerprints to the existing guarded services.
- Keep all storage, persistence and queue capabilities unavailable until protected Preview provider setup. The actions cannot proxy CSV bytes, activate data, alter freshness or create recommendations.
- Omit the historical standalone service document and README catalogue entry because they add no runtime or owner-facing value.

## 2026-08-08 — Lean bounded direct-upload client

- Extract only the useful executable portion of source-inventory order 32 from exact head `01c6667a23e7077993de87c0be4f8851b22925b3` onto verified `main` `8dfd1ae39f038c8bad73708b50c380a10bd209af`.
- Upload selected CSV `Blob` bodies directly to the exact private PUT targets returned by guarded intake; validate expiry, identities, byte lengths and candidate metadata before transferring any file.
- Preserve deterministic target order, stop before completion on transfer failure and bind completion to the reservation's exact upload-request fingerprint.
- Keep provider wiring, file preparation/hashing UI, private data, Preview execution and Production disabled. Omit the historical standalone service document and README catalogue entry as unnecessary for this private-owner runtime slice.

## 2026-08-08 — Lean bounded import file preparation

- Extract only the useful executable portion of source-inventory order 33 from exact head `c7dea5ccd2a031e6c6d979b50ec0ca6b915bb234` onto verified `main` `4b28aae719d8a17e59531886793bf4b6d9c7407e`.
- Validate one to 24 selected CSV files and prepare the exact intake metadata and original `Blob` references without copying or persisting private bytes.
- Hash files sequentially in bounded 64 KiB to 16 MiB chunks, report only client ID and byte-count progress, and preserve grouped Race Merge versus single replacement-snapshot rules.
- Reject unsafe metadata, duplicate identities, empty/oversized files, malformed digests and cancellation—including cancellation during the final asynchronous hash update.
- Keep the concrete incremental hasher, picker/UI, provider wiring, private data, Preview execution and Production disabled. Omit the historical README catalogue and standalone design document as unnecessary.

## 2026-08-08 — Lean authenticated import confirmation

- Extract only the useful executable portion of source-inventory order 34 from exact head `fd499d1b5fa6d93fd833e80ef9e397a87f04aa88` onto verified `main` `6eac03d7ca92add043dac9a4afd102a883081c5c`.
- Re-authenticate the configured single owner at confirmation time and bind the request to the exact preview ID, SHA-256 fingerprint, idempotency key and literal explicit-confirmation flag.
- Keep every hosted activation capability unavailable until Preview providers are deliberately configured, so confirmation cannot reserve or dispatch work in the repository-only state.
- Convert authentication-provider failures to a stable private error and preserve the newer upload-completion request-fingerprint binding already on `main`.
- Omit the historical README catalogue and standalone service document as unnecessary for the private-owner product.

## 2026-08-09 — Lean authenticated import recovery

- Extract only the useful executable portion of source-inventory order 35 from exact head `7ecfc18d8d8307211da31f71e1885cc795c0e555` onto verified `main` `024fd5361ed92f2983b6b853edd7255e0bd7d058`.
- Re-authenticate the configured single owner for every rollback request and require the exact active batch ID, a printable reason, an idempotency key and literal explicit confirmation.
- Preserve the guarded rollback contract: restore only a prior accepted source version, retain source provenance and mark aggregates pending before recommendations can refresh.
- Keep rollback persistence unavailable until the protected Preview database is deliberately configured; authentication-provider failures return a stable private error.
- Preserve the current upload-completion fingerprint and confirmation boundaries. Omit the historical README catalogue and standalone design document as unnecessary.

## 2026-08-09 — Private Vercel hosting activated

- The owner activated the private Vercel Production deployment and configured
  Clerk owner authentication. This supersedes earlier statements that the
  website itself remains Production-disabled.
- Keep `vercel.json` Git deployment automation disabled. Routine Git pushes,
  pull requests and intermediate heads must not create deployments.
- The hosted application remains an authenticated historical workspace with no
  accepted import connected. Do not display Phase 0 or disabled-Production copy
  as the current operating state.
- Production database schema/data, private object storage, queue providers and
  real private-data imports remain separately approval-gated and unchanged.

## 11 August 2026 — Race elapsed-time source unit confirmed

- The owner confirmed that Race Merge distance values are metres and elapsed-time values are seconds; for example, `52.500` means 52.500 seconds.
- Normalize elapsed time with `elapsed_time_milliseconds = elapsed_time_seconds * 1000` and derive speed with `distance_metres / elapsed_time_seconds`.
- Preserve the exact source decimal for provenance. The current integer-millisecond application boundary rejects sub-millisecond precision instead of silently rounding.
- Use these semantics consistently in compact Core Intelligence profiles, Search Core, Discovery and future race-profile materialization. The earlier elapsed-time-unit-unconfirmed limitation is retired.
