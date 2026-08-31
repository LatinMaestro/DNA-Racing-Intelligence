# Confirmed DNA Racing Rules

This document records owner-confirmed mechanics. Treat these as authoritative unless the owner later changes them. Historical/provisional rule statements are labelled explicitly and do not override newer confirmed authority.

## Core origin and classes

- Genesis cores are original, non-bred cores.
- Spliced/bred classes are Morphed, Freak and X-Class.
- A “Splice” tournament means spliced cores only and excludes Genesis.
- Hierarchy: Genesis → Morphed → Freak → X-Class.

## Breeding class matrix

| Parent 1 | Genesis | Morphed | Freak | X-Class |
| --- | --- | --- | --- | --- |
| Genesis | Morphed | Freak | Freak | X-Class |
| Morphed | Freak | Freak | X-Class | X-Class |
| Freak | Freak | X-Class | X-Class | X-Class |
| X-Class | X-Class | X-Class | X-Class | X-Class |

## Elements

Element order from highest to lowest:

1. Metal
2. Fire
3. Earth
4. Water

Offspring always takes the lower-ranked element of the two parents.

Examples:

- Metal × Fire → Fire
- Metal × Earth → Earth
- Fire × Water → Water
- Earth × Earth → Earth

## F-number

- Genesis cores are F1–F8.
- Offspring F-number is the sum of both parent F-numbers.
- There is no cap.

## Sex, cycles and splice limits

Sexes are male and female.

| Class | Lifetime splices | Cycle | Male uses/cycle | Female uses/cycle |
| --- | ---: | ---: | ---: | ---: |
| Genesis | Unlimited | 45 days | 3 | 1 |
| Morphed | 21 | 60 days | 3 | 1 |
| Freak | 12 | 60 days | 3 | 1 |
| X-Class | 3 | 60 days | 3 | 1 |

## Family restrictions

A core cannot breed with:

- either parent;
- any grandparent; or
- a full sibling sharing both parents.

These are the only confirmed family restrictions. Half siblings, cousins, descendants and other relationships are otherwise allowed.

## DNA base splice fees

Effective 7 July 2026:

| Element | Genesis | Morphed | Freak | X-Class |
| --- | ---: | ---: | ---: | ---: |
| Metal | 40 | 25 | 12 | 8 |
| Fire | 30 | 16 | 10 | 6 |
| Earth | 20 | 10 | 7 | 4 |
| Water | 10 | 6 | 4 | 3 |

Pairing cost:

- Pay only the higher of the two DNA base fees to the game.
- Add each external owner’s nominated arena fee.
- No nominated arena fee is paid for a core owned by the user.
- Two owned cores therefore cost only the higher DNA base fee.
- External recommendations must use the latest authoritative current Arena evidence available to the website. DNA Open Lab API is the preferred source once connected authority is proven; retained CSV Arena snapshots remain fallback evidence.

Historical no-overage material indicates a threshold of 3× DNA base fee, with overage above that threshold shared between DNA and the owner. Do not hardcode an overage split percentage unless later confirmed or required by current data.

## Hidden breeding quality

- Offspring racing qualities are hidden and probabilistic.
- Most possible breed rolls may be weaker than parent racing strength.
- There is a smaller probability of stronger offspring.
- Rare “supernatural” offspring can be exceptionally stronger than the parents.
- Strong parents do not guarantee a strong offspring, but historical data should be tested for whether they improve the probability distribution.

## Maiden Eligible

- Every newly bred core starts Maiden Eligible (ME).
- Newly minted Genesis cores may also be ME.
- ME remains until the core participates in a Maiden event.
- Entering at least one Maiden qualification race commits the core to that event.
- The visible ME tag remains through qualification, rounds and grand final.
- The tag is removed when that Maiden event concludes.
- It is removed even where the core entered only one qualifying race, failed to meet a minimum race count or failed to qualify.
- A core that enters no qualification race retains ME for a future event.
- Preserve ME for the core’s strongest credible mode-specific Maiden, even if another Maiden occurs first.
- API `is_maiden` or equivalent observed game state, once connected and proven, is a game-state observation. It must not silently erase local strategic/ME history or owner overrides.

## Tournament qualification

- A user may try to qualify as many cores as desired.
- Qualification conditions vary by tournament.
- Leaderboards may be split by element, breed/class, F-number or combinations.
- Ranking may use fastest time, median time, points, minimum races, top-X finishes or another configured metric.
- Top X or a qualifying percentage may progress from each leaderboard.
- Later rounds and finals are automatically run by the game.
- The user’s controllable decision is primarily qualification entry.
- A vault can occupy at most 50% of race gates.
- This is a maximum, not a recommended occupancy target.

## Auto-Entry

- The user can select a qualifying race, select multiple eligible cores and choose repeated race counts.
- The game auto-runs those entries.
- The website recommends candidates and allocations but does not control live occupancy or enter races.

## Race allowance

- Each core has up to 1,000 races in each mode.
- Not all races count; auto-run rounds and finals do not count.
- Do not calculate or display races remaining from export/API history unless DNA later exposes an authoritative remaining-race value with proven semantics.
- Discovery should nevertheless avoid wasting normal or qualification races.

## Modes and distances

Modes:

- bike;
- car;
- horse.

A dominant multi-mode racer is rare. Model modes independently.

Race distance values are measured in metres.

Calendar shorthand is confirmed:

- 10 = 1000;
- 12 = 1200;
- 14 = 1400;
- 16 = 1600;
- 18 = 1800;
- 20 = 2000;
- 22 = 2200.

Distance bands:

- sprint: 900–1400;
- middle: 1400–1800;
- marathon: 1800–2200.

Cores may be strong across adjacent distances or multiple bands.

## Performance interpretation

- Lower elapsed race time is better.
- Higher speed is better.
- Race time and speed by mode and distance are primary evidence.
- Finishing position has lower primary weight during discovery because opponents may also be testing unsuitable cores.
- In paid qualification racing, finish and in-the-money evidence can receive more weight.
- Do not initially assume paid versus free racing changes intrinsic ability.
- Do not initially assume payout format changes intrinsic ability; let historical evidence test this.
- Ignore race class because it is obsolete.
- Current API observations such as power, adjusted odds, variance, stamina, equipped assets, listing state or current racing statistics must remain timestamped current context until predictive lift and historical no-leakage treatment are proven.

## Minimum discovery sample

- Ten races per core × mode × exact distance is the minimum for a minimally analytical sample.
- Fewer races may justify an early hypothesis or early stop, but not a confident analytical conclusion.

## Burn

- Genesis cores cannot be burned.
- Morphed, Freak and X-Class cores can be burned.
- Burning is permanent.
- Historical family-tree records remain.
- Burn credits vary and are not required in the website.
- Burn decisions focus on improving vault quality, not maximizing credit return.

## Recent Horse Maiden example

This is an example template, not a universal rule.

- Two brackets: Top 2 and Double Up.
- Horse, all distances, four-gate qualifying races, approximately $0.01 per entry.
- Leaderboards split by element.
- Top 2: fastest single time, minimum one race, top 70% progress.
- Double Up: median time, minimum nine races, top 70% progress.
- A core can be worth entering primarily for one bracket.
- Shared versus separate qualifying race pools may vary and must be configurable.
- Top 2 rounds are approximately eight gates with top two advancing.
- Double Up rounds use varying 6–12 gate fields with half advancing.
- Both grand finals use 12 gates and seven races with configured scoring.

## Race Merge economic fields and currencies

Owner-confirmed Race Merge semantics remain authoritative historical/fallback evidence:

- `rpayout` is the race payout format/mechanism label. It determines how a race distributes prizes; it is not a monetary amount.
- `rfee` is the exact entry fee for that core's race entry.
- `prize` is the exact gross race prize/payout credited to that core's entry. The current export header is `prize`; informal references to `Rprize` mean this field.
- `toke_curr` identifies the asset used for both entry and payout. Normal supported racing assets are ETH and DEZ. Historical BGC race rows use the separately confirmed non-economic exception below.
- `r_tags` carries race restrictions or eligibility tags, including F-number, element, breed/class and ME restrictions where present.
- `rformat` remains a separate raw event-format field and must not be substituted for `rpayout`.

Amounts are unsigned source quantities. The ledger records a positive `rfee` as a debit and a positive `prize` as a credit. A numeric zero means no fee or no payout respectively. Blank, missing, malformed or negative values are not zero and must remain quarantined or review-required. Refunds and reversals are not represented by changing these meanings; they require explicit source or manual adjustment evidence.

DNA Open Lab API equivalents may supersede or supplement these fields only after P3 connected equivalence establishes their exact semantics. Differences are reviewable and must not silently change historical economic totals.

DEZ is the DNA Racing game token on Polygon mainnet:

- contract: `0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E`.

ETH is Ethereum's native crypto asset. Preserve all source token amounts exactly and report racing fees, payouts and net results in both the original asset and USD using a dated rate for the race's UTC calendar day. The daily rate and source must remain auditable and correctable.

Historical Race Merge rows whose `toke_curr` is BGC remain valid racing-performance evidence but are treated as free-entry, no-payout races. Their effective fee and payout are zero, they create no race-derived ledger transaction in any asset, and their source fee and prize do not enter economic totals or completeness queues. This is an exceptional historical rule and does not change the separate BGC ledger for genuine breeding, arena and burn activity.

BGC is otherwise separate from racing. It is used for breeding and burning and has an owner-confirmed reference conversion of USD 1 = BGC 1. Keep BGC in its own ledger and show any USD equivalent separately rather than silently mixing BGC with ETH/DEZ operating profit.

Current API token prices, once connected, are current/reference context only. They do not replace dated historical valuation.

## DNA Pro League — current roster authority

The current owner-provided/confirmed roster rules supersede the earlier 20 August announcement assumptions where they conflict.

### Mode

- The current Pro League is **Bike-only**.
- Car and Horse evidence must not affect Pro League roster ranking, Discovery priorities or map assignments.
- Bike/Car/Horse remain separate elsewhere in the private website. If DNA adds another Pro League mode later, introduce it only through a new versioned authority update.

### Vault and roster size

- My Vault is unlimited.
- A legal Pro League roster contains **12–25 Cores**.
- Do not force a 25-Core roster.
- Build the strongest compliant nucleus first, then add only Cores with meaningful incremental value while remaining at or above 12.

### Substitutions

- Maximum **10 substitutions per year**.
- Whether initial roster selection consumes this allowance is unresolved until DNA clarifies.
- The website must keep the initial-roster counting interpretation explicit/configurable and must not silently assume one answer.

### Element limits

- Maximum **7 Metal**.
- Maximum **8 Fire**.
- Maximum **10 Earth**.
- No current minimum Water count has been supplied.
- These are ceilings, not recommended targets.

### Genesis/F-number limits

- Maximum **2 Genesis Cores per element**.
- Maximum **5 Cores at F5 or below**.
- Maximum **12 Cores at F10 or below**.
- Minimum **2 Cores above F15**.

### Sex and identity

- At least **32% of the roster must be female, rounded up**.
- A 12-Core roster requires 4 females; a full 25-Core roster requires 8.
- Intermediate sizes use `ceil(roster size × 0.32)`.
- Every rostered Core must be named.
- The live trial observation is retained as evidence and the owner confirmed
  on 29 August that it controls current validation.

### Performance relationship and advice scope

- Pro League uses the same underlying Core stats/performance characteristics as normal DNA Racing.
- Historical **Bike** performance is therefore the applicable evidence for Pro League preparation, subject to normal chronology/sample/freshness rules.
- Raw win and Top-3 rates are descriptive supporting evidence, not the primary selection or ranking signal. Weak fields and off-distance Discovery entries can distort them.
- Compare candidates primarily from authoritative elapsed-time distributions for the same Bike race type and exact distance, with derived speed only when both distance and time authority are valid. Use median/trimmed time, variance, interquartile range, sample size and freshness rather than a single best run.
- Population strength is the comparison boundary: a Core that is merely best in the owner's Vault but remains weak against the same-format/same-distance Bike population is provisional/test-before-lock, not strong coverage.
- Gold/Blue stars and results against independently evidenced strong opposition may increase supporting confidence. Missing field-quality evidence remains unknown and never counts in a Core's favour.
- The visible Yellow star is the top-three signal stored in the historical `gold_star` source field; Blue remains the first-place signal.
- Raw star assignment or conversion against weak/unknown opposition cannot increase a Core's ranking. Only opposition-adjusted star evidence frozen before the race may support an otherwise performance-led comparison.
- Keep race outcome/win evidence separate from intrinsic performance evidence and expose the race line that supports every mapping recommendation.
- Current API evidence may enrich advice but must not be blindly blended into one opaque score or leak backward into historical backtests.
- Pro League preparation remains advisory only. The website must never create a team, enter a race, place a bet, mint, trade, sign with a wallet or execute a splice.

### Team setup and map assignment

- The owner creates the team manually on `https://esports.dnaracing.run/teams`.
- The owner manually sets a roster of 12–25 Cores.
- The current Maps page defines four published maps: **Anchor**, **Glory**, **Measure** and **Miracles**.
- Every defined map is a fixed ordered sequence of 42 races.
- A match is best-of-three maps.
- A map is first to 16 race points and must be won by two race points.
- A match is between two Vaults. Every race field is divided 50/50 between the
  two Vaults, including one entry per Vault in a 1v1 and half the published
  gates per Vault in larger fields.
- The home Vault picks map 1 and denies one map.
- The away Vault then picks map 2 from the two maps remaining after the home action.
- The match must retain its explicit third-map policy and result. Trial pages
  disagree on whether the denied map is excluded permanently or returns to a
  random third-map pool, so neither policy is a universal default.
- Each Vault pre-maps eligible Cores from its registered 12–25 Core roster to
  the selected map race lines.
- Race lines after 16 are reached only when the score remains close enough for the map to continue.
- Each race line has an exact race type and distance in metres.
- When assigning a Core, the owner can apply it only to the selected race or to every race on that selected map with the same race type and exact distance.
- The website may prepare and validate these lineups but must never click Set, submit a mapping, create a team, set a roster or choose a match map.
- Matches are expected to be scheduled about one day in advance. The owner
  must return to DNA Esports and complete the applicable home or away map action
  manually before lock.
- The website should analyse the opposing Vault, compare likely head-to-head
  exact-format and exact-distance strengths, rank our home pick/denial or away
  second-pick choices and recommend our best rostered Core for each line.
  Missing opposition evidence remains unknown rather than being treated as an
  advantage.
- Coverage reporting must distinguish a genuinely strong option from the Core
  that is merely the best currently available in our Vault. A weak
  best-available Core is a Discovery/breeding and possible future replacement
  priority, not an automatic reason to spend a roster place.
- With only 10 annual substitutions, marginal Cores should not be locked solely
  to fill every theoretical gap. If structural compliance forces temporary
  inclusion, label the Core provisional and preserve a clear replacement plan.
- No additional map is configured or assumed until DNA publishes it.

### Trial-only operations observed 29 August 2026

- Saved assignments cover all four maps, persist across matches and remain
  editable until match lock; later edits must not rewrite a locked match.
- A map ends on the first race that leaves a team at 16 or more points with a
  two-point lead. A 16–16 score continues, subject to the 42-line catalogue.
- A match ends when one team wins two maps; map 3 is not run after a 2–0 result.
- Standings currently show 3 points for a win, 1 for a draw and 0 for a loss,
  then event wins, race differential and race wins as tie-break displays.
- Unlimited roster edits, no ageing, day-as-Week tabs, trial payouts and missed
  pick fallbacks are practice-event observations, not permanent league rules.
- Core outcome, team race point, map score, match result and league points are
  separate facts and must remain separate in the private website.

Published map catalogue observed 27 August and revalidated 29 August 2026:

| Map | Name | Published race composition | First-16 average | All-42 average | Distance range |
| ---: | --- | --- | ---: | ---: | ---: |
| 1 | Anchor | 21 × 6-gate Madness, 19 × 1v1, 2 × 12-gate WTA | 1488 m | 1586 m | 1000–2200 m |
| 2 | Glory | 11 × 4-gate WTA, 11 × 6-gate WTA, 10 × 16-gate WTA, 10 × 24-gate WTA | 1600 m | 1586 m | 1000–2200 m |
| 3 | Measure | 7 each of 4-gate WTA, 6-gate WTA, 1v1, 6-gate Madness, 12-gate Madness and 24-gate Madness | 1600 m | 1610 m | 1000–2200 m |
| 4 | Miracles | 21 × 22-gate WTA, 21 × 24-gate Madness | 1688 m | 1610 m | 1000–2200 m |

## Historical Pro League announcement snapshot — superseded where noted

The owner supplied a DNA Community Update on 20 August 2026. The initial recorded provisional roster assumptions were:

- exactly 25 Cores;
- minimum five Metal, five Fire, five Earth and five Water;
- maximum two “gens” per element, provisionally interpreted as Genesis;
- minimum eight females;
- at least five F15+ Cores; and
- current competitive focus on Bike mode.

The announcement also described 12 Pro teams, an unlimited lower league, promotion/relegation, two weekly matches, best-of-three maps and first-to-16 maps. Those competition details remain provisional context unless later DNA authority changes them.

The **exactly-25**, **minimum-five-per-element** and **minimum-five-F15+** assumptions are retained here only as historical evidence and are superseded by the current roster authority above.
