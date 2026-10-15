# Verified DNA Analytics public feature review

Inspection date: 15 October 2026 (Australia/Brisbane)
Comparator: LatinMaestro/DNA-Racing-Intelligence main 5e4a96eb55646faf62d8b5fa4c7550096c27b451

## Conclusion

The competitor has working public discovery, Core profiles, race simulation, breeding previews, Esports reporting and public vault browsing. Its strongest transferable ideas are integrated navigation, concise decision summaries, editable race fields, itemised pair costs and map/segment drill-through. Execution verifies that outputs appear; it does not validate the competitor's formulas, calibration, underlying completeness or profitability. Preserve our approved analytical methods.

## Scope and limitations

All competitor interaction used Cloud Browser and public UI. No login, wallet connection, signature, payment, splice, race entry, betting or other game-state action occurred. GitHub was read only; no repository, issue or provider changes were made. No private owner dataset was sent to the competitor. A public team report labelled Latin Racing was opened from its existing team directory; no owner wallet identifier was entered. DK Racing was used for public vault browsing.
Desktop screenshots were captured at the browser's existing viewport (approximately 1360 x 936). Cloud Browser's documented controls expose no viewport resize/device emulation in this session. Mobile layout, touch navigation, mobile table overflow and mobile wallet UI therefore remain UNVERIFIED. Desktop screenshots are not mobile evidence. No mobile findings are inferred from CSS or desktop appearance.
Public and member boundaries were inspected, but authentication was not attempted. Member price, payment requirements and the eligibility decision after verification are unknown. The Members page says wallet verification uses a free message signature, records wallet address/vault name and lasts 30 days. That is not evidence that every membership entitlement is free.

## 1. Navigation and Core Search

Homepage -> Main Game/Core Search -> name or ID search -> Core profile -> mode and evidence tabs. Global Main Game and Esports navigation changes the available modules. Breeding opens Pair Finder with Pair Predictor in a submenu. Esports provides Team Report, Leaderboard and Core Rankings links.
URL: https://www.dna-analytics.app/core-search
Query Kingpin returned four matches from 19,929 indexed cores:

- Kingpin #1 — Metal/Genesis, Male, DK Racing
- Kingpin Legacy #14941 — Metal/Morphed, Female, Regent Racing
- Auction Kingpin #16452 — Water/Freak, Male, AuctioneerJosh.eth
- Jr Kingpin #15565 — Fire/Morphed, Female
  Initial searching showed a clear notice that building the whole-Core index may take several seconds. This was a name-search test with exact ID results, not an exhaustive search-quality benchmark or separate numeric-input test.

Core URL: https://www.dna-analytics.app/core/1
Same Core successfully switched between Bike, Car and Horse:

- Bike: rounded power 90%, variance 58%, adjusted odds 77%; A+, better than 96% of rated Bike cores; best-at 1000m, sprint not confirmed, 173 of 448 races at 1000m.
- Car: power 85%, variance 60%, adjusted odds 84%; A+, better than 96%; best-at 2200m, Mid-Marathon, medium confidence, 85 races, most raced 2000m.
- Horse: power 84%, variance 66%, adjusted odds 81%; A, better than 90%; best-at 1400m, Mid, medium confidence, 63 races, most raced 1200m.
  Grade update displayed 2026-10-14 22:22 UTC. This is a displayed grade timestamp, not proof of every underlying source cutoff.

PWR / VAR by distance (Horse) was public. It explicitly labels estimates as DNA Analytics' own benchmark, not official DNA numbers; All/Paid controls are available. Aggregate estimated PWR 78.9 versus official 83.7; estimated VAR 68 versus official 65.9. Returned table:

| Distance | Races | Estimated PWR | Estimated VAR | Typical time (s) | Spread (s) |
| -------- | ----: | ------------: | ------------: | ---------------: | ---------: |
| 1000     |     5 |          87.9 |            73 |            56.85 |       1.25 |
| 1200     |    15 |          80.5 |            79 |            70.75 |       1.39 |
| 1400     |    12 |          76.4 |            69 |            83.17 |       1.18 |
| 1600     |     5 |          82.5 |            58 |            94.79 |       0.92 |
| 1800     |     6 |          74.3 |            52 |           107.55 |       0.80 |
| 2000     |     5 |          74.9 |            70 |           119.63 |       1.16 |
| 2200     |     7 |          77.2 |            59 |           131.51 |       0.95 |

Under-ten samples receive a dot and a caution to treat estimates loosely. Formula and definition of typical/spread were not independently established.

Race History (Horse) returned 63 races, 19 wins, 30.16% win, 69.84% podium, Blue 54.0%, Yellow 52.4%, displayed prizes 9,046 DEZ, fees 10,101 DEZ and profit -1,055 DEZ. These are competitor-reported filtered figures, not audited owner P/L. Controls include fee lane, payout format, distance, gates, one-gate/quest/gridlock inclusion, finish distribution and speed views. Expanding the first race returned the complete field, times/gaps, odds, fee/prize metadata and a public race URL. The summary date was 2025-08-03 while the expanded localized date read Aug 4, 2025; timezone semantics were not explained during this test.
Family was public: Genesis/no parents, 24 offspring, seven burnt, average PWR 80% among 13 rated offspring, linked children, Hide burnt and sorting controls. Offspring score/comparison depth was member-gated. Telemetry and Core Pro League tabs were visible but not exercised; no claims about their outputs.

## 2. Race Simulator — public race URL

URL: https://www.dna-analytics.app/race-sim
Entered public URL obtained from expanded race history:
https://fbike.dnaracing.run/race/bf6cd9fe56
Loaded 4G Horses, Finished, Horse, 900m, four gates, snow-bridge-horse, Double Up, $1.50 entry/$5.40 prize. Field settings lock to the race; Unlock field and Clear are provided. Unlocking is described as dropping the linked race while retaining cores/game odds. No game operation is involved.
Important: the simulator supports 1000–2200m and explicitly substituted 1000m for this 900m race. Last-three/record remained at 900m. Do not adopt that mixed-distance comparison in our exact-distance method.
Returned outputs:

- Folly #81: actual 1st, 49.22s; est win 13.9%, fair odds 7.18x, game odds 5.97x; value Overrated 0.83.
- Kingpin #1: actual 2nd, 50.19s; est win 31.2%, fair odds 3.20x, game odds 3.65x; value Underrated 1.14.
- Quetzal Queen #18821: actual 3rd, 50.95s; est win 30.8%, fair odds 3.24x, game odds 3.08x; value About right 0.95.
- Reckless Charge #136: actual 4th, 51.78s; est win 24.0%, fair odds 4.17x, game odds 3.19x; value Overrated 0.77.
  The UI defines fair odds as 1/win rate with no house margin and value as expected returned stake at game odds if its simulation is right. These labels are visible definitions, not validated betting economics. A completed historical race simulation is not a point-in-time backtest; no assurance was obtained that later history was excluded. Thin-sample labels appeared for Folly (3) and Kingpin (5).
  Free: field load, result, estimated WR/fair odds, game-odds comparison, last-three deviations and historical records.
  Member-gated: fastest/average/slowest side-by-side times and In the green profitability-place probabilities.

## 3. Race Simulator — manual field

Cleared linked race, selected Bike, 1000m and 1v1, searched and added Kingpin #1 and Folly #81. Two-gate field calculated automatically:

- Kingpin: estimated 57.1%, fair odds 1.75x; est PWR 85.8/VAR 57; distance record 173 races, 24.3% wins, 64.7% top three.
- Folly: estimated 42.9%, fair odds 2.33x; est PWR 76.1/VAR 45; distance record 20 races, 30.0% wins, 75.0% top three.
  The summary compares Kingpin's estimated 57.1% against a two-gate 50% baseline. Gates can be cleared individually or together. Whole-vault addition is member-gated. This working workflow does not prove probability calibration or repeatability.

## 4. Breeding Pair Finder and Pair Predictor

Finder URL: https://www.dna-analytics.app/breeding/finder
Public controls: two vault selectors, Bike/Car/Horse, distance type, father/mother source toggles, parental minimums, parent-distance matching, offspring element/type, maximum total cost and sorts for grade/top-10% racer/PWR/value.
Executed default Bike stud-barn-to-stud-barn search. It reported 1,271 barn cores, 204,098 checked pairs (680 fathers x 579 mothers), 589 family exclusions, 189,033 parent-distance exclusions and 12 currently unable-to-breed cores. The displayed counts were not reconciled independently and do not form a simple complete cross-product audit.
It displayed ten free candidates, limited to three appearances per Core, and withheld 568 pairs predicted A- or better for members. Thus free rank #1 is not the overall model's best pair.
First visible pair Ionic Void #22747 x Toro II #22200:

- predicted Bike B+, Metal Xclass F8, likely Sprint, PWR 84.2 (80–89), total $72 = stud $30 + mare $17 + DNA fee $25.
  Top-10% racer and beating-both-parents probabilities are locked. Fees labelled live/estimated; no independent official validation was done.
  Details opened the predictor and automatically produced the result:
  https://www.dna-analytics.app/breeding/predict?father=22747&mother=22200&mode=bike
  Bike predictor: B+, typically better than 84% of rated Bike cores, same offspring descriptors and itemised $72 cost. Full PWR/ADJ/win/place ranges and top-racer/beats-both probabilities are member-gated. Switched to Car and pressed Predict:
  https://www.dna-analytics.app/breeding/predict?father=22747&mother=22200&mode=car
  Car: C+, better than 69% of rated Car cores, likely Sprint-Mid. Father PWR/ADJ were unavailable, mother PWR 84.5/ADJ 78.0. The displayed prediction despite missing parental metrics reinforces the need to preserve our own evidence gates. Horse predictor and alternate Finder filters were not executed.

## 5. Esports standings, power, team and map analysis

Team directory -> Latin Racing -> Summary/Heat map and Anchor filter.
https://www.dna-analytics.app/esports/team/953adec8ad
Latin Racing public summary: Lower League, power 54.1, 13th of 26; standings 13th with 9 points; matches 3–3 and rounds 187–166; next listed opponent T/J Racing week 7. Best map Anchor power 60.8/3rd/4–1; worst Glory 48.0/16th/0–3; Miracles 58.0/11th/1–2; Measure 51.1/15th/2–1.
Strength/weakness cards, Core contribution links and a segment selector are public. Summary selected 1000m 1v1: 66%, 4th of 26, 21 rounds. Rival comparison, pick/ban/field advice, relative rival weaknesses and rival field choices are member-gated. No rival result was accessed.
https://www.dna-analytics.app/esports/team/953adec8ad?view=heatmap
Grid partitions race format/gates x exact distance with round share, sample, league rank and map frequency. All maps 1000m 1v1: 66%, 21 rounds, 4th, approximately 1.4 occurrences/map. 2200m six-gate Madness: 83%, 12 rounds, 1st. Blank/grey cells distinguish absent/thin observations.
https://www.dna-analytics.app/esports/team/953adec8ad?map=Anchor&view=heatmap
Anchor changed 1000m 1v1 to 66%, 18 rounds, 3rd, 3.8/map; 1400m 1v1 33%, three rounds, 15th; 2200m 1v1 75%, ten rounds, 3rd. This verifies map filtering, not the underlying weighting formula. Individual segment-to-Core drill-through links were visible but not executed.

https://www.dna-analytics.app/esports/power-rankings
Public Standings: 12 Pro teams; combined/group and league/season navigation; displayed updated 14 October 2026 23:36 browser time. KING SHELDIKAR first, 7–0, rounds 268–196, 21 points; Team Fingerprint second, 7–0, 259–215, 21; High Voltage third, 6–1, 243–175, 18. These are site-presented official standings, not independently cross-checked against DNA.
https://www.dna-analytics.app/esports/power-rankings?view=power
Modelled power is separate from standings; tooltip says expected weighted round share versus average opposition after opponent allowance. All maps: High Voltage first 57.3 (58.3% rounds, 418 rounds, maps 13–3); KING SHELDIKAR second 55.5; Supreme Moto third 55.0. Official-standing differences are shown. Caption says Pro teams are rated within Alpha/Beta; cross-group comparability/calibration was not validated.
https://www.dna-analytics.app/esports/power-rankings?map=Anchor
Anchor filter changed High Voltage to 64.3 with 24 rounds, maps 1–0; Supreme Moto second 56.8 with 131 rounds, maps 4–1. Small samples still receive a prominent ranking; preserve uncertainty in our implementation. Lower League standings and Core Rankings were not separately executed.

## 6. Dashboard without wallet

https://www.dna-analytics.app/vault
Disconnected state offers wallet connection or public vault name/address lookup. Searched DK Racing, selected the matching public vault; no address entry or wallet authorization required.
https://www.dna-analytics.app/vault/0x6646c16922b32b21741145ae480588c48a11f436
Public DK Racing roster loaded 52 cores, mode switches, type/sex/element/distance/breedable/barn filters, sorts by grade/PWR/VAR/ADJ/races left/name and Core drill-through. Kingpin displayed A+, power 89.5, VAR 57.5, ADJ 77.3, 777 races left, 3/3 cycle splices. Other rows show unavailable metrics as dashes. Wallet-only personal workflow was not tested. Public browsing is useful scouting evidence, not a design precedent for publishing our owner's private analysis.

## 7. Membership boundary

https://www.dna-analytics.app/members
Gate requests wallet verification via free signed message, recording address/vault name with 30-day browser validity. Stopped at this screen. No price or payment requirement was visible. Classify the observed restrictions as MEMBER-GATED, not proven PAID. Header connection help describes signing in, while the disconnected vault copy says connection alone needs no signature; these refer to different stages and require careful distinction.

## 8. Comparison with current GitHub and Issue #120

Read main commit 5e4a96eb55646faf62d8b5fa4c7550096c27b451 dated 14 October 2026; README, AGENTS, analytical authority matrix/method, Search Core/Open Race/Breeding/Pro League/Vault Performance routes and commissioning matrix, plus Issue #120 body and latest comment page. This was source inspection, not connected testing of our site. No private deployment was opened, avoiding quota-consuming data fetches.
Issue #120's 15 October benchmark comment 6180748016 labelled the competitor ADVERTISED/UNVERIFIED after prior browsing failure. This inspection supplies actual public execution evidence, but does not amend the issue.
Source-backed internal status:

- Search Core already composes authenticated owner catalogue, Neon performance and optional bounded R2 history; My Vault drill-through exists.
- Breeding route composes an owner-scoped ranking repository; Pro League composes persisted evidence/current-state/sync and substitution services. Presence of adapters does not establish connected acceptance.
- Open Race page still explicitly injects unavailableOpenRaceWorkspaceRepository.
- Vault Performance page still explicitly injects unavailableVaultPerformanceSummaryRepository.
- Commissioning matrix also records unavailable Maiden, Lifecycle and Readiness adapters.
- Latest Issue #120 owner amendments prioritise real retained-data commissioning, defer remaining Race Merge/live catch-up as universal blockers, and require safe preparation to continue during quota pause.
- Recorded Neon October transfer 5,695,839,591 bytes exceeds the approved operating ceiling; no fresh provider capacity check was performed in this review. Treat this as last recorded evidence, not newly verified live usage. Recheck capacity before any connected work; the calendar alone does not authorize reads.

## 9. Prioritised recommendations — proposals only

P0 — Finish useful real-data wiring and protected acceptance. Complete compact owner-scoped Vault Performance summary persistence/adapter, then dependency-ready Maiden/Open Race/Lifecycle/Readiness sources. Preserve exact decimals, separate assets, coverage and existing formulas. Do not substitute broad raw-ledger scans. Proceed with offline code work while provider access is blocked; connected acceptance/deployment only after fresh positive A$0 headroom and privacy/rollback proof. Existing retained data is sufficient; do not wait for 100% history.
P1 — Consolidate Core lookup into one clear profile. Reuse Search Core and existing performance projections; persistent mode/exact-distance/format selection, concise top-level summary, distribution/sample table, history expansion and lineage links. Keep source current power/variance distinct from race-derived estimates. Do not import the rival grade or redefine our method. Evidence: strongest immediately usable competitor pattern, already adjacent to implemented wiring.
P1 — Give Open Race two input paths: validated public race URL/ID and manually editable field. First wire its existing workspace/read model. Parse trusted identity server-side, retain source timestamp/status, apply eligibility before ranking and invalidate on field change. Preserve frozen pre-entry recommendations after lock. Reject unsupported exact distance or clearly withhold the estimate; never substitute 1000m for 900m. Do not add dependable WR/odds/value labels until the existing approved probability/economic method is implemented and calibrated.
P1 — Make Pro League decision summaries lead to evidence. Add strongest/weakest maps, exact-format/distance heat maps, Core contributions and opponent scouting views using accepted data and existing Bike-only benchmarks. Separate official standings, descriptive results and predictions. Retain sample, opposition, chronology and current owner roster rules. Rival-derived power formula is not an approved replacement.
P2 — Add Pair Finder -> select-two-parent detail flow. Show parents side by side, exact-distance median/tail/repeatability, lineage support, independent confidence, official pair validity/descriptors, quote age and itemised same-asset costs. Keep TARGET/WATCH/WAIT, weaker-parent protection and performance-first ranking. Do not force best-available pairs, infer hidden stats or claim inherited upside probabilities without chronological validation. No splice action.
P2 — Streamline private Dashboard/navigation. Concise owned-Core overview, useful filters, direct links into evidence and resumable query state; keep owner authentication and private analyses. Do not add wallet verification, public owner profiles, membership system or third-party analytics dependencies.
P2 — Verify mobile deliberately when viewport controls are available. Test at 390/430px, keyboard/focus, horizontal table overflow, sticky Core/mode context, touch targets and heat-map readable labels; use card/detail views for dense data. These are proposed checks, not observed competitor mobile defects.

Acceptance for any follow-up: unchanged analytical outcomes on existing regression fixtures; explicit exact-mode/distance/format isolation; missing/partial/stale evidence stays honest; confidence/calibration shown only where supported; owner isolation, private Preview and no wallet/game actions; fresh provider A$0 capacity proof before connected reads/deployments. No paid upgrade, public release or new probability model is recommended by this review.

## Sources

https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120
https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6161310122
https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6161428641
https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6165048329
https://github.com/LatinMaestro/DNA-Racing-Intelligence/issues/120#issuecomment-6180748016
https://github.com/LatinMaestro/DNA-Racing-Intelligence/blob/5e4a96eb55646faf62d8b5fa4c7550096c27b451/docs/ANALYTICAL_METHOD_AUTHORITY_MATRIX.md
https://github.com/LatinMaestro/DNA-Racing-Intelligence/blob/5e4a96eb55646faf62d8b5fa4c7550096c27b451/docs/PRIVATE_WEBSITE_COMMISSIONING_READINESS_MATRIX.md

## Screenshot index (13 desktop captures)

dna-core-bike.jpg — Kingpin Bike overview
dna-core-distance-horse.jpg — Horse distance chart and own-estimate disclosure
dna-sim-public-race.jpg — public Horse race loaded, 900m/1000m substitution disclosure
dna-sim-manual.jpg — constructed Bike 1000m Kingpin/Folly 1v1 result
dna-pair-finder.jpg — free candidate cards, price breakdowns and locked probabilities
dna-pair-predictor.jpg — complete free pair preview and member gate
dna-team-report.jpg — Latin Racing summary and rival-analysis locks
dna-team-heatmap.jpg — all-map exact-segment grid
dna-esports-standings.jpg — official-labelled standings
dna-power-rankings.jpg — modelled power rankings
dna-dashboard-disconnected.jpg — wallet-free lookup alternative
dna-public-vault.jpg — public DK Racing roster
dna-members-gate.jpg — wallet-verification boundary

## Implementation record

The owner requested incorporation and implementation on 15 October 2026. This review supersedes the discovery-only evidence status in Issue #120 comment 6180748016, without replacing any accepted analytical method. Public competitor outputs above are observations, not approved game rules or owner-data fixtures. The original 13 screenshots remain in the privately saved inspection package rather than repository binaries.

| Learning                | Implemented presentation                                                                                                                                                | Remaining dependency                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrated Core profile | Search Core mode/exact-distance filters; preserved Core/query links; separate last import and per-profile cutoff; existing trimmed mean/IQR details; section navigation | Rich lineage and per-race rows require accepted compact read contracts                                                                       |
| Parent comparison       | Filter accepted rankings by mode, distance and unordered parent IDs; preserve original objective ranks; compare-parent disclosure and exact-context Core links          | Current official validity/itemised cost and unassessed pair prediction are not supplied by the ranking contract                              |
| Map drill-through       | Bike exact-type/distance mapping coverage grid; mapped/required/evidence-backed entry counts and map-detail anchors                                                     | Opponent-adjusted power, official standings and competitive-strength heat maps require accepted result/read models; coverage is not strength |
| Short dashboard path    | Core lookup and private module shortcuts with speculative prefetch disabled                                                                                             | Connected Dashboard economics/recommendations still require their existing adapters                                                          |
| Race URL/manual field   | Recorded trusted-input/field-lock/exact-distance acceptance criteria                                                                                                    | Open Race still has no authoritative compact persisted session adapter. Do not present an inert form as working analysis                     |
| Mobile                  | Wrapping forms, constrained parent selects/cards and keyboard-focusable horizontal map region                                                                           | Competitor mobile remains unverified; connected owner-site mobile acceptance cannot run through the current quota block                      |
| Data commissioning      | Current safe presentation work does not add queries, API calls, migrations or model weights                                                                             | Vault Performance compact summary, Maiden, Open Race, Lifecycle and Readiness persistence remain dependency-critical work                    |

Fresh metadata on 15 October reconfirmed Neon Free October transfer at 5,695,839,591 bytes, period ending 1 November 2026 00:00 UTC. No owner SQL, material R2 read/write, connected page test or deployment was performed. This blocks connected acceptance, not offline development. Automatic Git deployments remain disabled.

Traceability: Core display reuses `CorePerformanceProfile`, existing service validation and exact-distance distribution/star denominators; Breeding display reuses `BreedingPairRankingResult` without reranking or recalculating offspring distributions; Pro League grid uses only `ProLeagueOwnerCommissioningPlan.maps.lines` and counts existing mapping entries. No new probability, grade, performance weight, eligibility rule, economics, database query or source authority is introduced. Tests cover exact selection/no substitution, unknown evidence, original rank preservation and entry-count semantics.
