# Open Race Workflow

## 1. Purpose and delivery sequence

The Open Race tool is a read-only decision-support feature for comparing the
user's eligible owned Cores against Cores already entered by other vaults. Its
primary purpose is to help choose a Core **before the user commits an entry**.

The existing implementation is a manually captured fallback. After the major
API history/persistence critical path is commissioned, it becomes a live API
opportunity scanner while retaining the manual path for API gaps or outages.

The live scanner must:

- scan all API-visible open races that have at least 50% of their gates filled
  and at least one place available;
- exclude full, closed, cancelled, running and completed races;
- show every authoritative restriction and evaluate owned-Core eligibility
  before performance ranking;
- recommend one strongest eligible Core, explain useful alternatives, or advise
  avoiding the race;
- provide the authoritative DNA race-entry link for owner-manual action; and
- never enter a race, submit a game transaction or connect a wallet.

For an odd number of gates, the 50% threshold is rounded up to a whole filled
gate. The denominator and status must come from authoritative API fields rather
than inferred page layout.

## 2. Confirmed star timing

Yellow/source-Gold and Blue stars are not visible while the field is still being assembled and the user is deciding which core to enter. The visible Yellow top-three signal is retained in historical storage as `gold_star`.

The confirmed sequence is:

1. cores enter the available race gates;
2. the field becomes complete and the race is set to take place;
3. only then does the game reveal the Gold and Blue star assignments;
4. the race is about to run and the user’s core-entry decision has already been made.

Consequences:

- current-race Gold and Blue stars are unavailable during the core-selection stage;
- the Open Race recommendation must not request or depend on current-race star assignments;
- the tool must never imply that a star can be used to switch the selected core after the field is locked;
- historical Gold/Blue profiles may still be used as prior evidence about each entered core;
- a revealed current-race star is an observation and diagnostic signal, not an actionable pre-entry input.

## 3. Two-stage workflow

### Stage A — Core selection

The API-native workflow should populate, where authoritatively available:

- mode;
- distance;
- gate count;
- race format;
- entry fee and currency where relevant;
- eligibility restrictions;
- IDs or names of opposing cores already entered;
- available gates;
- any other visible non-star race parameters.

The owner may manually supply or correct these fields only through the retained
fallback when the live source is unavailable or incomplete. Manual and API
sources must remain visibly distinguished.

The website should then provide:

- ranked eligible owned cores;
- recommended owned core;
- strongest alternatives;
- historical expected-time comparison;
- historical Gold/Blue evidence for the entered cores;
- expected finish distribution where supportable;
- strongest known opponents;
- confidence and data-current-through date;
- avoid recommendation where appropriate.
- a direct authoritative link to the DNA race-entry page.

The selection-stage recommendation must clearly state:

> Current-race stars are not yet available. This recommendation uses imported historical data and the manually entered field only.

### Stage B — Field locked / star observation

After all gates are filled and the game is about to run, the user may optionally record:

- which core received the Gold star;
- which core received the Blue star;
- whether the same core received both;
- the observation time;
- an optional note.

This stage is optional and observational only.

The website may:

- compare the game’s revealed stars with the website’s prior ranking;
- show whether the user’s selected core received Gold, Blue, both or neither;
- record the observation for later review;
- use it as a temporary diagnostic pending the next Race Merge import.

The website must not:

- issue a replacement-core recommendation after the field is locked;
- imply the user can change the committed entry;
- describe the observation as a successful prediction before the race runs;
- treat the observation as a completed race result;
- permanently duplicate the star record when the same event later appears in an imported Race Merge file.

## 4. Optional manual observation storage

Manual current-race star observations are useful only where the user chooses to record them. The website should not require this workflow because later Race Merge exports are expected to contain the authoritative historical Gold/Blue fields.

Where manual observations are supported, store:

- a local/manual observation ID;
- optional game event ID if visible;
- race parameters;
- observed Gold core ID;
- observed Blue core ID;
- observation timestamp;
- source type `manual_pre_run_star_observation`;
- reconciliation status;
- created/edited audit metadata.

The manual observation must remain separate from the accepted imported race-entry record until reconciled.

## 5. Reconciliation with later race imports

When a later Race Merge export contains the same event:

- match by authoritative event ID where available;
- otherwise use a cautious composite candidate match based on date/time, mode, distance, gate count and entered core set;
- compare imported Gold/Blue assignments with the manual observation;
- mark an exact match as reconciled;
- surface a mismatch for review;
- never create duplicate star counts or analytical evidence;
- treat the imported source as the authoritative historical record unless the user records a supported correction.

Manual observations that cannot be safely matched must remain excluded from permanent historical star aggregates by default.

## 6. Historical star evidence in selection

Although current-race stars are not visible during selection, the Open Race tool may use imported historical star evidence for each entered core.

Examples include:

- historical Gold rate in eligible fields at the same mode and distance;
- historical Blue rate;
- stars received over strong fields;
- time/star agreement;
- star specialization;
- data coverage and freshness.

Historical star evidence remains supporting evidence. Race time and speed by mode and exact distance remain primary.

## 7. Gate rule

Gold stars do not exist in races with three gates or fewer.

Therefore:

- Stage B must not expect a Gold assignment for a 1-, 2- or 3-gate race;
- the UI should show **Gold not applicable at this gate count**;
- only Blue may be entered where the game displays it;
- any manually recorded Gold at three gates or fewer must be flagged as an anomaly rather than silently accepted.

## 8. Data freshness and limitations

The Open Race tool combines:

- live API race/field observations where available;
- manually entered fallback information where required; and
- accepted historical Core and opponent intelligence.

The UI must distinguish these sources clearly.

It must show:

- which fields were entered manually for the current race;
- the historical data-current-through date;
- the last import time;
- freshness status;
- unresolved opponent IDs or missing histories;
- whether the current field came from the live API or manual fallback;
- the exact observation time and recommendation-expiry state; and
- whether any API or historical-data limitation reduces confidence.

Any change to status, gate fill, entrants, restrictions, fee or scheduled race
identity invalidates the cached recommendation and requires re-evaluation. A
stale recommendation must not be labelled live.

## 9. Live recommendation method

Eligibility is a hard gate, not a score. Only currently owned Cores that satisfy
all authoritative race restrictions may be ranked. This includes mode and
element/class restrictions such as Metal-only races, plus any future API-exposed
condition whose semantics are established.

For each eligible Core, the recommender should use:

1. exact race type plus exact distance performance;
2. valid elapsed time and derived speed where distance/time authority permits;
3. variance, consistency, sample size and freshness;
4. direct performance against current entrants and field/opponent quality where
   identities and evidence are available;
5. historical Gold/Blue star evidence as supporting context only; and
6. fee, payout structure and estimated net opportunity where authoritative data
   supports it.

Distance-only or broader fallback evidence must be labelled and confidence
reduced. Missing opponent evidence is neutral, never favourable. Raw win or
podium rate cannot override inferior time/speed/variance evidence, particularly
where prior fields were weak or off-distance.

The output must explain why the leading Core was selected, why alternatives rank
lower, why Cores are ineligible, evidence cutoff/freshness and any population gap.
Where no eligible Core has a supportable payout case, the preferred output is
**avoid** rather than a forced recommendation.

## 10. Live scan request budget

The scanner shares the conservative base allowance of no more than 30 aggregate
requests/minute across the configured key pool. It must not assume that the
entire allowance is continuously available.

Use a bulk-first, change-aware plan:

- fetch the active-race inventory in the fewest supported calls;
- filter status, available places and the 50%-filled threshold before requesting
  additional field detail;
- reuse the commissioned owner/Core/history store rather than refetching static
  analysis inputs for every scan;
- refresh rapidly only while a qualifying race is changing or close to filling,
  and back off for unchanged or distant races;
- honour every `X-RateLimit-*` header, `Retry-After`, body-authoritative status,
  endpoint bulk limit, key health and failover decision; and
- reserve capacity for the commissioned persistence/catch-up workload, failing
  closed to last-good data on exhaustion or outage.

The direct DNA URL must be supplied by an authoritative API link or a separately
validated race-ID route contract. Do not guess a URL pattern.

## 11. Tests

Automated tests should cover:

- selection-stage forms contain no required current-star inputs;
- selection recommendations do not depend on current-race star values;
- historical star profiles remain available as prior evidence;
- Stage B cannot be activated before the user marks the field as locked/about to run;
- Stage B is labelled observational only;
- no replacement-core recommendation is issued after lock;
- Gold is unavailable at gate count three or fewer;
- manual observations reconcile idempotently with later authoritative imports;
- unmatched observations remain excluded from permanent historical aggregates;
- imported/manual mismatches are surfaced;
- source labels distinguish manual current-field data from periodic imported history.
- only open races meeting the rounded-up 50%-filled threshold are recommended;
- full/closed/running/completed races and races with no places are excluded;
- every API restriction is applied before scoring, including element-only cases;
- field changes invalidate cached recommendations;
- unknown opponent evidence cannot improve a Core's score;
- avoid is returned when no supportable eligible entry exists;
- canonical DNA links are validated and no entry/wallet/game action occurs; and
- scan behaviour remains within aggregate/per-key budgets across 429, retry,
  lower-allowance, outage and catch-up conditions.

## 12. Completion standard

The Open Race workflow is complete when it continuously finds qualifying live
races within the safe API budget, applies every eligibility restriction before
ranking, explains recommendations or avoidance, opens the authoritative DNA race
page for manual entry, works without unavailable current-race stars, retains the
manual fallback, and never misrepresents post-entry information as a pre-entry
competitive advantage.
