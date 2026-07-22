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
- Serialize acceptance by owner and source before calculating the next version, and activate exactly one immutable version only after all transaction writes succeed.\n- Store cumulative Race Merge/Core Details identities as immutable version deltas rather than copying the multi-million-row active set on every import; resolve the active set through non-rolled-back deltas.
- Treat Race Merge and Core Details as cumulative sources whose omitted accepted records carry forward; fingerprint disagreement is quarantined without overwriting the accepted fact.
- Treat Current Vault and Current Arena as replacement historical snapshots whose earlier versions remain rollback-capable.
- Reject a data-current-through regression without changing the active version, and keep import completion, data current-through and aggregate completion separate.
- Record one exact contribution per accepted natural key and batch. An accepted batch replay returns its existing version, while the owner/source/checksum constraint prevents duplicate file registration.
- Queue aggregate refresh after activation without claiming completion.
- Rollback requires a reason, preserves staged and contribution provenance, marks the active batch/version rolled back and restores the latest prior non-rolled-back version.
- Protect all acceptance tables with forced owner RLS and revoke table and function access from PUBLIC. Application-role grants and persistent Preview migration remain gated.
- Verify migration apply, exact replay, cumulative conflict handling, stale quarantine, snapshot replacement, atomic failure rollback, owner isolation, privilege revocation, rollback and full reverse migration in ephemeral PostgreSQL 16 CI.
