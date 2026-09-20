# Helix Tournament Execution Architecture

Status: **Accepted future architecture; post-critical-path implementation only**  
Authority date: **20 September 2026**  
Tracking issue: **#555**  
Scope: private single-owner DNA Racing Intelligence deployment.

## 1. Purpose and delivery placement

This document defines the owner-approved future architecture for automating paid tournament qualification **and Free-racing Discovery** after the current API/Pro League critical path and private website commissioning are complete.

It is intentionally **not** current Production execution authority. The existing critical-path application remains advisory/read-only with respect to DNA Racing write actions until the release gates in this document are satisfied.

Primary objectives:

> **Tournament execution:** use DNA Racing Intelligence to select profitable tournament qualification opportunities and an owner-authorised local executor to enter suitable races with HLX credits while applying realised-P/L stop losses and hard spend/exposure controls.

> **Free Discovery execution:** use the same planning/execution/reconciliation framework to run controlled zero-entry-fee Discovery campaigns across Bike, Car and Horse, including both broad normal-Free distance discovery and deliberate challenger-vs-proven-Core benchmark screens.

Tournament qualification remains the paid/exposure-sensitive use case. Free Discovery is a first-class zero-fee execution mode, not an informal fallback.

## 2. Current owner-confirmed HLX mechanics

Owner-confirmed current game mechanics:

- HLX (Helix) is an in-game race-entry credit.
- Owner-confirmed conversion relationship is 1 HLX : 1 DEZ.
- The DNA race-entry UI permits payment from the HLX credit balance.
- HLX-funded entries do not require a MetaMask/wallet approval popup.
- Race winnings from HLX-funded fills are credited back in HLX credits.

Current Open Lab authority remains separate:

- `llm.txt` documents read-side race families including `races/active`, `races/finished`, `races/docs` and `races/fills`.
- Current token-price context includes HLX.
- No public Open Lab race-entry mutation is documented.

Therefore the executor must **not invent an unsupported Open Lab write endpoint**. The first implementation must instrument and reuse the first-party DNA HLX entry action from an owner-authenticated local session.

## 3. Why direct race-by-race execution is preferred

DNA Auto-Entry is no longer the preferred tournament executor.

Direct race-by-race HLX execution gives the controller exact authority over:

- which race is entered;
- which Core is used;
- current field composition;
- owned-Core collision prevention;
- expected-value/race-quality filtering;
- unsettled exposure;
- stop-loss enforcement; and
- immediate halt by simply ceasing to submit new entries.

This is materially better than preloading a large Auto-Entry queue and attempting to cancel after losses become visible.

DNA Auto-Entry remains a secondary/fallback executor for:

- normal-Free Discovery campaigns and controlled benchmark campaigns when its selection controls are sufficient;
- race surfaces where single-entry execution is unsupported;
- DEZ-only activity if required;
- failure or instability of the native single-entry request contract; or
- explicitly owner-selected bulk workflows.

## 4. Target topology

```text
DNA Open Lab v1 read API
        |
        v
DNA Racing Intelligence
        |
        +--> Tournament configuration + segment definitions
        +--> Core ranking / confidence
        +--> Open Race opportunity scanner
        +--> Race-quality / EV scoring
        +--> Realised P/L + committed exposure
        +--> Stop-loss / spend ceilings / kill switch
        +--> Durable execution intents + audit log
        |
        v
Owner-authorised local executor
(always-on trusted desktop / small trusted machine)
        |
        v
DNA first-party authenticated HLX race-entry action
        |
        v
Open Lab reconciliation + result settlement
```

The phone is a private monitoring/control surface, not the always-on executor.

## 5. Trust boundaries

### Cloud website

The cloud application may hold:

- tournament configuration;
- eligible/ranked Core state;
- race opportunity state;
- planned execution intents;
- P/L and committed exposure;
- stop-loss and spend-limit state;
- executor heartbeat/health state;
- immutable audit events; and
- private push-notification subscriptions.

It must not store:

- wallet private keys;
- seed phrases;
- signing credentials;
- raw owner browser cookies;
- raw DNA session tokens; or
- unattended blockchain signing authority.

### Local executor

The local executor runs under an owner-controlled authenticated DNA browser/session. It may use the existing authenticated context to submit HLX-funded first-party race-entry actions.

Do not move that write action server-side unless a later explicit security review proves it can operate without exporting private browser/wallet credentials.

## 6. Tournament segment model

A tournament may contain multiple independent execution segments. A segment is the smallest independently controlled qualification lane, for example:

- tournament + mode + distance + element;
- tournament + mode + distance + breed/class;
- tournament + mode + distance + F-group; or
- any configured leaderboard split/composite eligibility group.

Multiple segments may execute concurrently.

Each segment persists:

- tournament/ruleset version;
- segment identity and eligibility rules;
- ordered eligible Core queue;
- current selected Core;
- Core confidence state (`high_confidence` / `uncertain`);
- minimum qualification race requirement;
- completed qualification count;
- pending/unsettled entry count;
- realised qualification P/L;
- committed/unsettled exposure;
- stop-loss;
- optional Core-specific stop-loss override;
- max unsettled exposure;
- segment spend ceiling;
- execution status; and
- last authoritative reconciliation timestamp.

## 7. Core execution policy

### High-confidence Cores

A high-confidence Core is authorised to pursue the full minimum required qualification count immediately.

This does **not** mean all minimum entries must be committed simultaneously. The controller may cap unsettled exposure, for example allowing only two or three pending races at once, while continuously working toward the minimum.

This exposure cap is not artificial `2+2+2+2` performance staging. It exists only to prevent avoidable committed spend while race results remain unresolved.

### Uncertain Cores

An uncertain Core may receive an intentionally smaller initial entry allowance before the planner authorises further qualification attempts.

The uncertainty classification is a pre-entry planning decision. Once entries are active, the only live poor-performance stop trigger is realised P/L.

## 8. Hard one-owned-Core-per-race rule

The owner rule is stricter than DNA's general gate-occupancy cap:

> **Never place more than one owned Core into the same race.**

Before every submission the controller must use the freshest authoritative race/fill evidence available and reject the candidate race if any Core from the owner's current vault is already entered.

This rule is mandatory and cannot be weakened by opportunity scoring, expected value or tournament urgency.

If ownership/fill evidence is stale, incomplete or ambiguous, fail closed and do not enter.

## 9. Race opportunity selection

The executor should not enter the first eligible race blindly. It should use the existing/future Open Race intelligence to choose the best available tournament opportunity for the active Core.

Pre-entry scoring may consider:

- exact tournament and segment eligibility;
- mode, exact distance, gate count and format;
- current field composition;
- known opposing Core quality;
- Core exact-format/exact-distance performance evidence;
- expected finish/payout distribution where supportable;
- weak-segment evidence;
- entry fee and prize structure;
- expected-value estimate where the source contract supports it;
- gate fill level and likely time-to-start;
- remaining qualification requirement;
- current pending exposure;
- realised P/L and stop-loss headroom; and
- one-owned-Core-per-race guard.

A future optional **last-in preference** may favor nearly full races when it improves start certainty, but it must remain subordinate to eligibility, self-competition, spend and P/L controls.

## 10. P/L is the only live poor-performance stop metric

For a Core × tournament segment:

```text
realised P/L = confirmed qualification payouts - confirmed qualification entry fees
```

Rules:

- preserve exact HLX amounts;
- never use binary floating point for money/credits;
- unsettled/pending entries are committed exposure, not realised loss;
- use authoritative settled fees and payouts only;
- if USD reporting is shown, preserve original HLX and apply the existing dated/authoritative conversion policy;
- do not stop because of elapsed time, speed, placing, stars, power, variance or projected qualification chance;
- those other metrics may select/rank Cores and races before entry only.

When:

```text
realised P/L <= configured stop-loss
```

set the Core/segment to `stop_loss_triggered` and submit no further qualification entries.

## 11. Spend and exposure controls

Independent hard controls:

- max unsettled entries per Core/segment;
- max unsettled HLX exposure per Core/segment;
- Core-specific stop-loss override;
- segment spend ceiling;
- tournament spend ceiling;
- global daily/session spend ceiling; and
- global pause/kill switch.

No scoring model may bypass these controls.

## 12. Native first-party action discovery

Because Open Lab does not document a write endpoint, commissioning begins with one manually observed controlled HLX entry.

Capture only the sanitised request contract:

- URL/path;
- HTTP method;
- non-secret body fields;
- race ID representation;
- Core ID representation;
- HLX payment selector/value;
- success/failure response shape;
- stable action/entry identifier if available.

Never capture into repository logs, issues or artifacts:

- cookies;
- bearer/auth headers;
- session tokens;
- wallet secrets;
- private keys; or
- seed phrases.

If a stable authenticated first-party request can be replayed inside the owner's local authenticated browser context, prefer that to DOM automation.

If the native contract is unstable, use browser UI automation as the fallback.

## 13. Entry state machines

### Per race entry

```text
candidate
  -> selected
  -> reserved
  -> submit_requested
  -> submitted
  -> reconciled
  -> pending_result
  -> settled

failure branch: failed
```

### Per Core × segment

```text
queued
  -> active
  -> monitoring
  -> minimum_complete

or

queued/active/monitoring
  -> stop_loss_triggered

other terminal/control states:
segment_complete | paused | failed
```

Every action uses an idempotency key and must be reconciled before retry.

## 14. Concurrency model

Multiple segments may run at the same time.

The controller must support concurrency without allowing:

- the same Core to be double-scheduled incompatibly;
- two owned Cores in one race;
- duplicate entry submission after timeout/retry;
- segment spend limits to be evaluated against stale committed exposure; or
- race reservations to become orphaned after executor failure.

Use durable reservations with short expiries and reconciliation-before-retry semantics.

## 15. Reconciliation

Open Lab remains the authoritative read-side reconciliation channel where its contract supports the relevant fact.

Reconcile:

- current open race availability;
- current race fills/fields;
- owned-Core appearance after submission;
- completed qualification starts;
- confirmed fee/payout evidence;
- realised HLX P/L;
- pending/unsettled exposure;
- remaining minimum qualification requirement; and
- executor/session health.

If entry submission succeeded locally but authoritative read-side confirmation is delayed, mark the action `submitted_unconfirmed`/equivalent and do not submit again until reconciled or explicitly failed.

## 16. Mobile control and notifications

Because routine HLX entries require no MetaMask approval, the owner should not receive per-entry approval notifications.

The private PWA/Web Push layer should notify on exceptions and meaningful milestones:

- stop-loss hit / Core stopped;
- minimum qualification races completed;
- segment completed;
- low HLX balance;
- Core/segment/tournament/global spend ceiling reached;
- local executor offline;
- DNA login/session expired;
- entry submission failure;
- reconciliation failure or prolonged uncertainty; and
- optional periodic tournament summary.

Each notification deep-links to the relevant private tournament/segment/Core state.

## 17. Free Discovery execution

The race-entry agent must support Free Discovery as a separate campaign family from paid tournament execution.

### 17.1 Normal-Free discovery campaign

Purpose: systematically determine a Core's useful and weak mode/distance ranges without paying race-entry fees.

A normal-Free campaign persists:

- Core ID;
- mode;
- exact distance;
- target number of **new** Free races;
- existing usable Free sample;
- campaign reason, such as unresolved short/middle/long coverage, burn-safety classification, Maiden preparation, tournament preparation or general Discovery;
- completed/pending entry counts;
- Horse/Car/Bike ageing budget and remaining ageing where available;
- star/finish/time evidence accumulated during the campaign;
- stop/completion status; and
- evidence cutoff used when the campaign was created.

Execution rules:

- select only authoritative normal races whose race name qualifies as standalone `Free`;
- enforce the requested mode and **exact distance**;
- use the owner-specified race class/gate/format constraints when the campaign defines them;
- default to **one owned Core per Free race** for ordinary discovery;
- do not enter a Core into an unrequested distance merely because a suitable Free race is available;
- stop scheduling once the campaign's new-race target is reached;
- stop or pause if ageing, ownership, eligibility, session, race-contract or data-freshness guards fail; and
- reconcile every submitted entry/result before counting the campaign complete.

Free campaigns have no realised-P/L stop-loss because the entry fee is zero. Their hard controls are race-count target, ageing budget, pending-exposure count, campaign pause/kill switch and evidence completion.

### 17.2 Targeted proven-Core benchmark campaign

Purpose: test a challenger against a **proven same-mode/exact-distance owned Core** and observe which Cores receive Yellow/source-Gold and Blue stars.

This mode intentionally creates a narrow exception to the normal one-owned-Core-per-race policy:

> A targeted 4-gate Free benchmark race may contain **exactly two owned Cores**: one challenger and one pre-selected proven benchmark. Never place a third owned Core into that race.

Requirements:

- benchmark Core quality must be established **before entry** from same-mode/exact-distance evidence;
- challenger and benchmark must use the same mode and exact distance;
- prefer 4-gate normal-Free races so two independent external opponents remain;
- persist challenger Core ID and benchmark Core ID as an explicit pair;
- use a bounded race target, normally the owner-approved 2–5-race screen or another explicitly configured count;
- Yellow/source-Gold and Blue stars are the primary small-sample latent-ceiling signal for this controlled screen;
- finish position and elapsed time remain secondary context;
- when neither owned Core receives a star, capture the external star holder and review its pre-existing same-mode/exact-distance quality before interpreting the race negatively;
- repeated stars over proven benchmarks strengthen the challenger case even when finish/time are noisy; and
- no-star results never trigger an automatic burn/bench conclusion without opportunity and external-star-holder context.

The benchmark Core is a control, not filler. The planner must not choose a merely convenient owned Core and label it proven.

### 17.3 Discovery campaign state

At minimum:

```text
planned
  -> queued
  -> searching
  -> race_selected
  -> reserved
  -> submit_requested
  -> submitted
  -> reconciled
  -> result_pending
  -> result_recorded
  -> searching | target_complete

control/terminal states:
paused | ageing_guard_hit | authority_stale | failed | cancelled
```

For benchmark campaigns, the reservation and reconciliation identity includes both owned Core IDs and the race ID.

### 17.4 Discovery opportunity scoring

Free-race selection may consider:

- campaign mode and exact distance;
- authoritative `Free` classification;
- gate count and available places;
- whether another owned Core is already entered;
- for benchmark screens, whether the intended benchmark is already paired with the challenger;
- known external field quality;
- likely time to fill/start;
- campaign remaining-race requirement;
- Core ageing exposure;
- pending/unsettled campaign entries; and
- whether the race advances a specific unresolved Discovery question.

Do not optimise free campaigns for payout or entry-fee EV.

## 18. DNA Auto-Entry fallback

DNA Auto-Entry is not removed from the product model; it is a secondary executor alongside the preferred direct race-by-race local agent.

Commission it separately before use.

For paid tournament execution, preserve tournament controls where technically possible:

- one owned Core per race;
- realised-P/L stop-loss;
- spend ceilings;
- idempotent create/cancel actions;
- pending exposure accounting; and
- exact audit/reconciliation.

For Free Discovery, Auto-Entry must support campaign-scoped configuration:

- selected Core(s);
- mode;
- exact distance;
- authoritative Free-race constraint;
- new-race target;
- normal-discovery versus targeted-benchmark campaign type;
- optional proven benchmark Core;
- max owned Cores per race: one for normal discovery, exactly two for benchmark mode;
- ageing/race-count guards; and
- pause/cancel plus reconciliation state.

If DNA Auto-Entry cannot guarantee the benchmark pair or owned-Core occupancy limit, use the direct local executor instead.

## 19. Audit requirements

Persist an immutable owner-scoped audit record for:

- opportunity observed;
- opportunity rejected and reason;
- entry selected;
- reservation created/expired;
- submission requested;
- submission succeeded/failed;
- reconciliation confirmed/failed;
- fee committed;
- payout settled;
- realised P/L updated;
- stop-loss triggered;
- segment/Core paused or completed;
- spend ceiling triggered; and
- owner kill-switch actions;
- Discovery campaign created/paused/completed/cancelled;
- Discovery target-race count and ageing guard evaluated;
- benchmark challenger/benchmark pair selected;
- Free race selected/rejected and reason;
- external star holder observed; and
- Discovery result reconciled into the evidence store.

Every audit record must bind to tournament configuration version, segment identity, Core ID, race ID, action/idempotency ID and timestamps.

## 20. Release gates

Implementation may begin only after the current delivery critical path is complete or the owner explicitly reprioritises it.

Commissioning order:

1. Persist tournament segment state plus Discovery campaign state and guard configuration.
2. Build race opportunity scoring without execution for both paid tournament and Free Discovery lanes.
3. Build local executor heartbeat/control protocol.
4. Instrument one owner-supervised **Free** entry first, because it exercises the native entry action without paid exposure.
5. Prove one normal-Free campaign entry end-to-end with read-side reconciliation and duplicate prevention.
6. Prove the normal-Free one-owned-Core-per-race guard.
7. Prove one targeted 4-gate benchmark Free entry with exactly the configured challenger + proven benchmark and no third owned Core.
8. Prove benchmark result reconciliation, star capture and external-star-holder review linkage.
9. Prove a bounded multi-race Free campaign stops exactly at its configured new-race target and ageing guard.
10. Manually observe one low-cost HLX tournament entry and record only the sanitised paid-entry contract shape.
11. Prove one synthetic paid request-shape flow.
12. Prove one owner-supervised automated low-cost HLX tournament entry.
13. Prove tournament one-owned-Core-per-race, P/L accounting, stop-loss halt, spend/exposure ceilings and kill switch.
14. Prove concurrent independent tournament segments and Discovery campaigns cannot create incompatible Core/race reservations.
15. Add PWA/Web Push exception/milestone notifications.
16. Expand to broader unattended execution only after all prior gates pass.

Fail closed on contract drift, stale ownership/fill authority, ambiguous eligibility, executor/session failure or unreconciled prior action.

## 21. Relationship to current architecture

`docs/ARCHITECTURE.md` remains the current critical-path architecture authority. Its advisory/read-only game-action boundary continues to control current Production and critical-path work.

This document is the accepted **future extension architecture**. It becomes actionable only after the release gates above and explicit owner commissioning.

Tracking issue #555 is the canonical implementation backlog and owner-authority thread for this feature.
