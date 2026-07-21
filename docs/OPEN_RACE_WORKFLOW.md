# Open Race Workflow

## 1. Purpose

The Open Race tool is a secondary manual decision-support feature for comparing the user’s eligible owned cores against cores already entered by other vaults.

It is not connected to the DNA Racing game and cannot fetch live race state. The user manually enters the information visible in the game.

The primary purpose is to help choose a core **before the user commits an entry**.

## 2. Confirmed star timing

Gold and Blue stars are not visible while the field is still being assembled and the user is deciding which core to enter.

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

The user may manually enter:

- mode;
- distance;
- gate count;
- race format;
- entry fee and currency where relevant;
- eligibility restrictions;
- IDs or names of opposing cores already entered;
- available gates;
- any other visible non-star race parameters.

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

- manually entered current field information; and
- historical imported race intelligence that may be several days old.

The UI must distinguish these sources clearly.

It must show:

- which fields were entered manually for the current race;
- the historical data-current-through date;
- the last import time;
- freshness status;
- unresolved opponent IDs or missing histories;
- that the website is not connected to live game data.

## 9. Tests

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

## 10. Completion standard

The Open Race workflow is complete when it can help select a core without relying on unavailable current-race stars, optionally record the stars after the field locks, reconcile those observations with later imports, and never misrepresent post-entry information as a pre-entry competitive advantage.
