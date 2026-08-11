# Private Owner Scope

## Purpose

DNA Racing Intelligence is a basic private website for one owner. It is not a SaaS product, team platform, public service, enterprise governance system or general-purpose data platform.

The implementation goal is the minimum architecture and interface required to deliver the already-agreed owner functionality safely and reliably against the known private datasets.

## Build only what is needed

Retain or build a component only when it is necessary for one or more of:

- the agreed owner-facing racing, breeding, lifecycle, tournament, Maiden, Open Race, Vault, Discovery, Core Intelligence or Vault Performance functionality;
- correct import and processing of the agreed periodically imported game-data sources, including the multi-million-row Race Merge history;
- basic owner authentication and private access;
- data integrity, deterministic replay, rollback or duplicate prevention that is necessary to avoid corrupting the owner's data;
- basic accounting correctness for the agreed ledger and economic features;
- practical privacy and security for a private hosted website;
- enough background processing or private object storage to make the known large imports work reliably on hosted infrastructure.

Do not add functionality merely because it would be useful to a larger public or commercial product.

## Owner-approved Vault and Core Search simplification — 10 August 2026

This section is a current owner decision and overrides older specifications, phase notes and import contracts wherever they still require a Current Vault CSV as an ongoing source.

- Retire the Current Vault spreadsheet from future imports and from the normal owner workflow. The owner does not want a one-time CSV seed and will manually establish the approximately 200 current Vault cores in the website.
- The recurring imported game-data set is every sequential Race Merge segment, one Core Details export (historically/legacy named Bike Details) and one Current Arena export. The currently inspected set contains seven Race Merge segments and nine recurring files across three imported source families. New Race Merge rollover segments extend this count without changing the source contract.
- Core Details remains the authoritative game-wide core catalogue. Current ownership and Maiden Eligibility are private owner-maintained state keyed to the durable Core Details ID; race history must never be used to infer current ownership.
- The Vault workspace must let the owner search by core name or core ID; filter owned cores by element, breed/class, sex and F-number; and toggle `In My Vault` and `ME Eligible` on or off. Removing a core from the active Vault must not delete its historical race, lineage, breeding, lifecycle or economic evidence.
- Maiden Eligibility remains a separate current state from ownership. It is used by Maiden strategy only after the core is in the active Vault and continues to follow the already-confirmed one-use Maiden commitment rules.
- Add a private game-wide **Search Core** function for marketplace due diligence. It must find any known core by name or durable core ID and show the existing Core Details, lineage, Bike/Car/Horse, exact-distance, benchmark, sample-size, confidence and historical performance evidence that is supportable from accepted imports. It must not imply ownership or perform marketplace/wallet actions.
- **Discovery keeps its original meaning.** Discovery is not marketplace/core discovery. It is the owner-Vault testing planner that identifies promising but under-tested owned core × mode × exact-distance combinations and recommends efficient test races to populate evidence. It must use direct results first, then lineage and supporting population evidence; show current exact-distance sample count and races needed to reach the 10-race minimum; recommend an initial probe where warranted; provide stop/continue guidance; and conserve races by deprioritising weak hypotheses. All recommendations remain advisory and never enter a race automatically.
- Search Core and Discovery must remain separate workflows: Search Core answers “what do we know about this game-wide core?”, while Discovery answers “what should I test next on a core I own?”.

Until the older source documents are reconciled during implementation, this section is authoritative for Vault ownership, source-count assumptions, Search Core and Discovery scope.

## Explicitly out of scope

Unless the owner later requests them, do not add:

- multi-user accounts, organisations, teams, invitations, roles or enterprise RBAC;
- public pages, public APIs, public sharing or discoverability;
- wallet connection, signing, automatic game actions or automated transactions;
- enterprise audit administration or formal compliance programmes;
- elaborate observability, multi-region, high-availability or disaster-recovery platforms;
- provider abstraction solely to support hypothetical future vendors;
- general workflow engines where a simple import job/queue is sufficient;
- formal attestation frameworks, evidence registries or governance dashboards;
- separate PRs whose only purpose is to restate evidence already produced by real tests;
- unsupported Side Event rules, Season Calendar functionality or speculative game mechanics;
- decorative product features that do not improve the owner's agreed workflows.

## Remaining offline queue treatment

The historical offline merge queue is a source inventory, not a requirement to merge all 80 staged branches.

For every remaining queue item:

1. Identify the actual executable or owner-facing value.
2. Integrate only the smallest useful delta onto current `main`.
3. Skip work that is obsolete, duplicated, evidence-only, governance-only or unnecessary for this private single-owner product.
4. Consolidate related documentation/evidence items instead of creating ceremonial PRs.
5. Preserve essential privacy, security, data-integrity and accounting safeguards; simplification must never mean accepting data corruption, cross-owner access, secret exposure or incorrect financial totals.

Orders 60-80 are not individually mandatory. Extract only any executable test/control that materially protects the private website; otherwise retire or consolidate them into normal final verification.

## Minimum hosted target

Use the smallest hosted stack that makes the agreed workflows practical:

- Vercel for the private Next.js website;
- one owner-authentication path;
- Neon PostgreSQL with a least-privilege application role;
- private object storage only because the large imports should not be proxied through ordinary request handlers;
- one simple background queue/worker path only where required for bounded multi-million-row import processing.

Do not introduce additional hosted services without a concrete need.

## Verification standard

Verification should be practical rather than ceremonial. Before practical owner use, require:

- formatting, linting, strict TypeScript and the real automated test suite;
- successful optimized build;
- migration apply/reverse safety for migration-bearing changes;
- production dependency audit and secret/privacy scan;
- synthetic owner-isolation and import replay/rollback checks;
- basic accessibility and responsive-browser checks for owner workflows;
- one consolidated end-to-end private Preview verification;
- real private-data validation only after explicit owner approval for upload.

Do not create separate governance artefacts merely to prove that these checks ran when GitHub Actions, test logs or concise release notes already provide the evidence.

## Completion definition

The website is complete when the owner can privately sign in and perform the agreed workflows with the agreed imported data and owner-maintained Vault state, with correct results, understandable freshness/limitations and reliable import/recovery behaviour.

A public launch programme, enterprise readiness programme or additional governance package is not required for completion.
