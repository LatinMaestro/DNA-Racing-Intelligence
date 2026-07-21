# DNA Racing Intelligence

Private, single-user decision-support and analytics platform for improving the repository owner’s DNA Racing vault.

The product will analyse historical race times, lineage, current vault holdings, active arena listings, user-configured tournament qualification rules and recorded economic activity to support:

- tournament and Auto-Entry selection;
- Maiden Eligible strategy;
- targeted mode and distance discovery;
- vault profit/loss and economic performance tracking;
- breeding and arena partner selection;
- open-race comparison; and
- race, retain, breed, sell or burn decisions.

## Repository status

The repository is currently in the specification and governance stage. Application implementation begins with Phase 0 after the documentation foundation is reviewed and merged.

## Source-of-truth documents

- [`AGENTS.md`](AGENTS.md) — autonomous agent operating instructions
- [`docs/MASTER_SPECIFICATION.md`](docs/MASTER_SPECIFICATION.md) — complete product requirements
- [`docs/GAME_RULES.md`](docs/GAME_RULES.md) — confirmed DNA Racing mechanics
- [`docs/ANALYTICS_METHOD.md`](docs/ANALYTICS_METHOD.md) — statistical and recommendation methodology
- [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) — imports, provenance and privacy controls
- [`docs/VAULT_PERFORMANCE_ACCOUNTING.md`](docs/VAULT_PERFORMANCE_ACCOUNTING.md) — vault P/L, BGC, manual payouts and economic-ledger requirements
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — phased implementation plan
- [`docs/REVIEW_GATES.md`](docs/REVIEW_GATES.md) — points requiring owner approval
- [`docs/DEFINITION_OF_DONE.md`](docs/DEFINITION_OF_DONE.md) — completion and quality standard
- [`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) — confirmed decisions and corrections
- [`CODEX_START_PROMPT.md`](CODEX_START_PROMPT.md) — initial autonomous Codex handover prompt

## Privacy

Real race, vault, core, arena and economic exports are confidential and must not be committed to Git. Development and tests must use synthetic fixtures. The deployed product is private, authenticated and non-indexed. The application must never request crypto private keys or seed phrases and must not initiate wallet or game transactions.