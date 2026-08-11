# Owner Vault and Core Search Development Plan

Date: 10 August 2026  
Status: owner-approved product direction

This plan is subordinate to `docs/PRIVATE_OWNER_SCOPE.md` and is the current implementation plan for replacing the Current Vault spreadsheet with owner-maintained Vault state and adding game-wide Core Search. It also records the functional-intent audit requested by the owner.

## 1. Product model

Keep three concepts separate:

1. **Game-wide Core Catalogue** — sourced from Core Details (legacy Bike Details) and enriched by accepted Race Merge history and lineage.
2. **My Vault** — a private owner-maintained overlay keyed to durable Core ID.
3. **Discovery** — a testing planner for active owned cores, not a marketplace discovery tool.

Current ownership must never be inferred from race history. Removing a core from My Vault must never delete historical race, lineage, breeding, lifecycle or economic evidence.

## 2. Imported source simplification

Retire Current Vault CSV from the normal import pipeline.

Recurring imported game-data files:

- the growing sequential Race Merge export series (currently seven files);
- one Core Details export, historically/legacy named Bike Details; and
- one Current Arena export.

The recurring import has three source families and a variable file count because DNA starts a new Race Merge export when the current file reaches its record limit. The current supplied set is seven Race Merge files plus Core Details and Current Arena. Historical Current Vault profiling remains useful only as prior evidence and is not an acceptance requirement for future imports.

The owner will manually establish the initial approximately 200 Vault cores; do not build a one-time Current Vault CSV seed.

## 3. My Vault owner workflow

Implement a simple private Vault manager backed by durable Core Details IDs.

Required current state:

- `in_my_vault` Boolean;
- `me_eligible` Boolean/current state;
- owner identity;
- last-updated timestamp/version needed for safe concurrency.

Required interface:

- show active owned cores;
- search the game-wide Core Catalogue by partial/exact core name or durable core ID so a core can be added;
- filter the Vault by element, breed/class, sex and F-number;
- toggle **In My Vault** on/off;
- toggle **ME Eligible** on/off for active owned cores;
- show enough identity attributes to avoid selecting the wrong same/similar-name core;
- preserve Bike/Car/Horse separation in downstream analytics;
- use owner-only authenticated writes, idempotency and basic optimistic-concurrency protection.

Turning **In My Vault** off removes the core from current owned recommendations and ME inventory but retains all historical evidence. No spreadsheet freshness label should be shown for owner-maintained Vault state; instead show the relevant last owner update where useful.

## 4. Game-wide Search Core

Add a private **Search Core** workflow for marketplace research.

Minimum search:

- durable Core ID;
- exact or partial core name.

Minimum profile evidence, where supported by accepted imports:

- core ID and name;
- breed/class, element, F-number and sex;
- parents, offspring and useful lineage links;
- Bike, Car and Horse evidence kept separate;
- exact-distance race count and performance;
- best, median and average time;
- speed and consistency/variance evidence where available;
- historical benchmark comparison;
- Gold/Blue supporting evidence with correct eligibility/denominators;
- sample size, confidence and data-current-through freshness;
- clear current My Vault / ME status where applicable.

The profile is advisory marketplace due diligence only. It must not connect to a marketplace, buy a core, sign a wallet action or imply that a searched core is owned.

Reuse the existing Core Intelligence analytical aggregates where practical rather than building a second statistics system.

## 5. Discovery — preserve original analytical intent

The authoritative Master Specification and Analytics Methodology remain correct: Discovery identifies promising but under-tested **owned** core × mode × exact-distance combinations and recommends efficient test races so useful statistics can be populated without wasting races.

The current implemented Discovery review queue is a safe intermediate stage, not the final product. Complete it to provide:

- recommended mode and exact distance;
- current direct exact-distance sample count;
- additional races required to reach the minimum 10;
- recommended initial probe size rather than blindly running all remaining races;
- direct-time and historical benchmark rationale;
- lineage rationale in the established priority order: own results, parents, grandparents, full siblings, half siblings, offspring, wider lineage, then population patterns;
- supporting Gold/Blue evidence with Gold gate eligibility and field-relative context;
- tournament or ME strategic relevance where applicable;
- explicit stop, pause or continue guidance after probe evidence;
- confidence and freshness;
- modes/distances not worth prioritising.

Ten exact-distance races is a minimum analytical boundary, not proof. Direct results remain primary. Lineage can form a hypothesis but cannot replace direct observations. Weak hypotheses should be stopped early when direct and lineage time evidence are poor. Limited unexpected-outlier probes remain allowed.

Discovery must never become a game-wide marketplace search function and must never enter races automatically.

## 6. Dependent-module rebinding

Replace Current Vault snapshot dependencies with the owner-maintained Vault registry wherever current ownership or ME state is needed:

- **Dashboard:** current owned-core and ME inventory summaries.
- **Core Intelligence:** show My Vault state where relevant while retaining historical performance evidence.
- **Discovery:** candidate universe is active My Vault cores only.
- **Tournaments:** recommend only eligible active My Vault cores; preserve the configured qualification metric and 50% gate cap-not-target rule.
- **Maiden:** use owner-maintained ME state and compare Bike/Car/Horse opportunities before commitment.
- **Breeding:** owned-parent availability comes from active My Vault state; Arena remains the external-parent source.
- **Lifecycle:** current actions apply to active My Vault cores; sold/removed/burnt historical evidence remains retained; Genesis remains non-burnable.
- **Open Race:** pre-entry candidate recommendations use eligible active My Vault cores; post-lock observation remains separate.
- **Vault Performance:** current ownership may aid filtering, but historical economics must remain even after a core leaves My Vault.

## 7. Import-pipeline cleanup

After owner-maintained Vault state is implemented:

- remove Current Vault from supported upload detection, preview, completion and rollback paths;
- remove Current Vault from required source-count/readiness assumptions;
- keep historical Current Vault code only where temporarily required for a safe migration, then delete it rather than maintaining two ownership authorities;
- preserve the existing Race Merge, Core Details and Arena import integrity/recovery behavior;
- update synthetic fixtures and tests to use owner-maintained Vault state.

Do not upload the historical Current Vault spreadsheet merely to seed the new model.

## 8. Functional-intent audit

Review against `MASTER_SPECIFICATION.md`, `ANALYTICS_METHOD.md`, `GAME_RULES.md`, `STAR_SIGNAL_SPECIFICATION.md`, `OPEN_RACE_WORKFLOW.md` and `VAULT_PERFORMANCE_ACCOUNTING.md` found no owner-approved redefinition of the other core modules. Their original end-state remains authoritative:

- **Core Intelligence:** mode/exact-distance evidence and benchmarks for known cores.
- **Tournament:** configurable qualification planning; configured metric controls ranking; 50% is a cap, never a target.
- **Maiden:** preserve the one-use ME opportunity for the strongest credible cross-mode use.
- **Breeding:** separate elite-upside, Vault-fit and balanced rankings; external Arena freshness matters; Vault saturation cannot suppress elite-upside.
- **Lifecycle:** race/discover/reserve/breed/hold/sell/burn advice with unresolved-evidence protection; Genesis cannot burn; no predicted BGC credit.
- **Open Race:** Stage A pre-entry selection and Stage B post-lock star observation remain separate.
- **Vault Performance:** auditable asset-separated accounting; BGC separate; no fabricated completeness, profit or conversions.

Several current pages are deliberately staged read-only or non-actionable boundaries. That is implementation incompleteness, not a change to their intended final owner-facing function. Development must complete the original practical workflows rather than reinterpret the staged copy as the final product definition.

## 9. Suggested implementation order

1. Reconcile authoritative source/import contracts and source counts.
2. Add the owner-maintained Vault persistence model and safe owner-only write service.
3. Build My Vault search/filter/toggle interface.
4. Rebind current-ownership and ME consumers to the new Vault registry.
5. Remove Current Vault CSV from the live import pipeline and tests.
6. Add game-wide Search Core using the existing Core Intelligence aggregates.
7. Complete Discovery from the current probe-review stage to the original targeted test-race recommendation contract.
8. Run consolidated synthetic regression across Dashboard, Core Intelligence, Discovery, Tournament, Maiden, Breeding, Lifecycle, Open Race and Vault Performance.
9. Deploy only at the next meaningful hosted milestone; keep automatic Vercel Git deployment disabled.

## 10. Acceptance

This change is complete when:

- the owner can manually establish and maintain My Vault without a Current Vault spreadsheet;
- Vault search supports name/core ID plus element, breed/class, sex and F-number filtering;
- every current-ownership-dependent module uses the same owner-maintained registry;
- Search Core can inspect any known game core without implying ownership;
- Discovery recommends efficient test races for owned cores according to the original analytical rules;
- Race Merge, Core Details and Arena imports remain reliable and recoverable; and
- no historical evidence or economic records are lost when ownership changes.
