# Confirmed DNA Racing Rules

This document records owner-confirmed mechanics. Treat these as authoritative unless the owner later changes them.

## Core origin and classes

- Genesis cores are original, non-bred cores.
- Spliced/bred classes are Morphed, Freak and X-Class.
- A “Splice” tournament means spliced cores only and excludes Genesis.
- Hierarchy: Genesis → Morphed → Freak → X-Class.

## Breeding class matrix

| Parent 1 | Genesis | Morphed | Freak | X-Class |
|---|---|---|---|---|
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
|---|---:|---:|---:|---:|
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
|---|---:|---:|---:|---:|
| Metal | 40 | 25 | 12 | 8 |
| Fire | 30 | 16 | 10 | 6 |
| Earth | 20 | 10 | 7 | 4 |
| Water | 10 | 6 | 4 | 3 |

Pairing cost:

- Pay only the higher of the two DNA base fees to the game.
- Add each external owner’s nominated arena fee.
- No nominated arena fee is paid for a core owned by the user.
- Two owned cores therefore cost only the higher DNA base fee.
- External recommendations must use the latest active arena export.

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
- Do not calculate or display races remaining from export history.
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

Owner-confirmed Race Merge semantics:

- `rpayout` is the race payout format/mechanism label. It determines how a race distributes prizes; it is not a monetary amount.
- `rfee` is the exact entry fee for that core's race entry.
- `prize` is the exact gross race prize/payout credited to that core's entry. The current export header is `prize`; informal references to `Rprize` mean this field.
- `toke_curr` identifies the asset used for both entry and payout. Normal supported racing assets are ETH and DEZ. Historical BGC race rows use the separately confirmed non-economic exception below.
- `r_tags` carries race restrictions or eligibility tags, including F-number, element, breed/class and ME restrictions where present.
- `rformat` remains a separate raw event-format field and must not be substituted for `rpayout`.

Amounts are unsigned source quantities. The ledger records a positive `rfee` as a debit and a positive `prize` as a credit. A numeric zero means no fee or no payout respectively. Blank, missing, malformed or negative values are not zero and must remain quarantined or review-required. Refunds and reversals are not represented by changing these meanings; they require explicit source or manual adjustment evidence.

DEZ is the DNA Racing game token on Polygon mainnet:

- contract: `0xdc4F4eD9872571d5eC8986a502A0D88F3a175f1E`.

ETH is Ethereum's native crypto asset. Preserve all source token amounts exactly and report racing fees, payouts and net results in both the original asset and USD using a dated rate for the race's UTC calendar day. The daily rate and source must remain auditable and correctable.

BGC is separate from racing. It is used for breeding and burning and has an owner-confirmed reference conversion of USD 1 = BGC 1. Keep BGC in its own ledger and show any USD equivalent separately rather than silently mixing BGC with ETH/DEZ operating profit.
