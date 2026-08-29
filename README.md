# DNA Racing Intelligence

Private, single-owner decision-support and analytics platform for improving the repository owner's DNA Racing vault.

## Current data-source authority

DNA Racing Intelligence is now **API-only on the delivery critical path**. The target data path is:

`DNA Open Lab v1 API -> server-only client and sync planner -> private R2 evidence/cache where useful -> canonical source adapters -> owner-scoped Neon read models and aggregates -> private authenticated website`

The DNA Open Lab base URL is `https://api.dnaracing.run/fbike/pub/v1`. API authentication is server-side Bearer only. The browser must never receive the API key or call the DNA API directly.

The existing CSV importer and equivalence harness are preserved but **benched**. They are optional future integrations and are not prerequisites for API persistence, Pro League commissioning or private website commissioning. No new CSV export is required from the owner for current delivery.

Where DNA Open Lab does not expose a required fact, the API-only product must show that dimension as unavailable or limited. It must not fabricate the value or silently restore CSV as a critical-path dependency.

If API eligibility or the key becomes unavailable, background sync pauses only. The website must continue serving the last successfully synced dataset and its analytical read models, with clear freshness/staleness indicators. Catch-up resumes from durable checkpoints when access returns.

API-backed use remains non-commercial unless the owner explicitly approves a different licensing/commercial position. API-backed UI must attribute DNA Racing.

## Product scope

The product supports:

- Pro League roster preparation and ongoing readiness;
- My Vault and Core Intelligence;
- exact-distance and cross-mode historical performance analysis;
- Gold/Blue pre-race star-signal analysis;
- targeted Discovery;
- breeding and lineage research;
- official Splice Arena/pair validation and cost preview where exposed by the API;
- read-only Open Race intelligence and current-field analysis;
- tournament and Maiden strategy;
- Vault Performance and asset-separated economics; and
- lifecycle advice covering race/discover/Maiden/breed/hold/sell/burn.

Recommendations are advisory only. The website must not create teams, enter races, place bets, mint, trade, sign with a wallet, perform splices or initiate any other game/wallet transaction.

## Pro League authority

The current owner-confirmed Pro League roster rules are:

- My Vault is unlimited;
- a legal roster contains **12 to 25 Cores**;
- roster construction is quality-first: build the strongest nucleus and add only Cores with meaningful incremental value while remaining at or above 12;
- maximum 10 substitutions per year;
- whether the initial roster selection consumes the substitution allowance remains unresolved/configurable until DNA clarifies;
- maximum 7 Metal, 8 Fire and 10 Earth;
- maximum 2 Genesis per element;
- maximum 5 Cores at F5 or below;
- maximum 12 Cores at F10 or below;
- minimum 2 Cores above F15;
- at least 32% females, rounded up (4 for 12 Cores; 8 for 25); and
- every rostered Core must be named.

The older announcement assumptions of exactly 25 Cores, minimum five of each element and minimum five F15+ Cores are retained as historical evidence but are **superseded** for current validation and recommendations.

## Repository status

The application remains private/authenticated with automatic Vercel Git deployments disabled. Production remains an explicit owner-approval boundary.

The API-first transition has begun with:

- the typed DNA Open Lab v1 server client contract; and
- initial API-neutral canonical adapters with deterministic raw-evidence checksums and provenance.

The delivery priority is the earliest safe **private owner-usable Pro League commissioning**, followed by complete private website commissioning. Persistent real API backfill remains blocked until the documented capacity/recovery proof is complete and the owner explicitly approves the first persistent real Preview sync.

## Source-of-truth documents

- [`AGENTS.md`](AGENTS.md) — autonomous delivery and safety instructions
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — current API-first phased delivery plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current API-first architecture and storage boundaries
- [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) — API/client/canonical data contract and optional CSV boundary
- [`docs/DATA_UPDATE_WORKFLOW.md`](docs/DATA_UPDATE_WORKFLOW.md) — API sync, backfill and outage workflow
- [`docs/ESPORTS_PRO_LEAGUE_PREPARATION.md`](docs/ESPORTS_PRO_LEAGUE_PREPARATION.md) — current Pro League rules and preparation strategy
- [`docs/GAME_RULES.md`](docs/GAME_RULES.md) — confirmed DNA Racing mechanics and current Pro League rule authority
- [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) — current decisions and supersession record
- [`docs/MASTER_SPECIFICATION.md`](docs/MASTER_SPECIFICATION.md) — complete product requirements
- [`docs/STAR_SIGNAL_SPECIFICATION.md`](docs/STAR_SIGNAL_SPECIFICATION.md) — Gold/Blue signal requirements
- [`docs/ANALYTICS_METHOD.md`](docs/ANALYTICS_METHOD.md) — statistical and recommendation methodology
- [`docs/VAULT_PERFORMANCE_ACCOUNTING.md`](docs/VAULT_PERFORMANCE_ACCOUNTING.md) — economic/accounting requirements
- [`docs/REVIEW_GATES.md`](docs/REVIEW_GATES.md) — owner-approval boundaries
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) — completion and quality standard
- [`docs/PRIVACY_AND_THREAT_MODEL.md`](docs/PRIVACY_AND_THREAT_MODEL.md) — privacy and threat controls

Specialised historical phase documents remain useful implementation evidence. Where a specialised document conflicts with the eight current authority documents above, the current API-first authority takes precedence.

## Privacy and secrecy

Real API payloads, raw exports, database dumps, owner-specific derived records and service credentials must not be committed to Git. Tests use deterministic synthetic fixtures. Private R2/Neon data remains owner-scoped and access-controlled. API keys, crypto private keys, seed phrases and signing credentials must never be exposed to the browser, Git, CI logs, Issue comments or chat.
