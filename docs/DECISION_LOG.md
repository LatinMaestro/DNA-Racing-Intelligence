# Decision Log

## 2026-07-21 — Product and delivery

- Product is private and for one user only.
- Development is online-only through GitHub/Codex and hosted services.
- Balanced objective: tournament success, financial performance where relevant, elite discovery, breeding value and overall vault improvement.
- Tournament rules must be configurable because qualification formats vary.
- Qualification is the main controllable stage; later rounds and finals are auto-run.

## 2026-07-21 — Performance modelling

- Bike, car and horse are separate.
- Primary evidence is race time and speed by exact distance.
- Lower elapsed time is better; higher speed is better.
- Finishing positions are secondary during discovery and can gain weight in paid qualification contexts.
- Do not initially assume payout or tournament format changes intrinsic performance.
- Ignore legacy race class.
- Ten exact-distance races is the minimum minimally analytical sample.
- Do not calculate remaining lifetime races.

## 2026-07-21 — Discovery

- Discovery is lineage-informed, not random.
- Historical evidence priority: own results, parents, grandparents, full siblings, half siblings, offspring, wider lineage, broad population patterns.
- Permit controlled probes for unexpected elite outliers.
- Stop weak paths early.

## 2026-07-21 — Maiden

- Genesis may be ME if newly minted; all new bred cores begin ME.
- Any qualification participation commits ME to that Maiden.
- ME remains visible until the event concludes, then is removed.
- Non-participation preserves ME.
- Wait for the strongest projected Bike, Car or Horse Maiden rather than using the first available event.
- A core may be entered primarily for one of several shared brackets.

## 2026-07-21 — Tournament entry

- User may try to qualify many cores.
- Vault occupancy is capped at 50% of gates but should not be targeted.
- User manages live occupancy and prefers outside entries to reduce loss risk.
- Auto-Entry recommendations identify candidates, initial repetitions and stop/continue rules.

## 2026-07-21 — Breeding

- Hidden qualities are probabilistic and rare exceptional “supernatural” outcomes exist.
- Analyse whether historical data provides predictive breeding lift without claiming certainty.
- Current arena is the source for external availability.
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
- Every performance report must state coverage, unclassified activity and whether it is complete, partial or estimated.
- Never request or store wallet private keys, seed phrases or signing credentials.