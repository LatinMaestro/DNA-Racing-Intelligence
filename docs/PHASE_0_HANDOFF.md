# Phase 0 Handoff

Date: 22 July 2026  
Status: **Gate A review required**  
Production: **disabled and unchanged**

## Delivered

- full source-of-truth reread and documentation-only repository confirmation;
- private inspection of the supplied export schemas and scale without committing files, rows or user-specific derived outputs;
- architecture decision covering Next.js, Clerk, Neon, private R2, hosted Python/Polars/DuckDB processing and Vercel Preview;
- privacy threat model, data-flow diagrams, retention proposal and categorical exclusion of wallet signing secrets;
- strict TypeScript Next.js scaffold with responsive accessible navigation;
- placeholder routes for Dashboard, Imports, Vault, Core Intelligence, Discovery, Tournaments, Maiden, Breeding, Lifecycle, Open Race and Vault Performance;
- historical-snapshot freshness placeholders without invented dates or figures;
- deterministic foundations and tests for confirmed breeding, burn, Gold/Blue, Open Race, freshness, exact-value accounting and deployment rules;
- CI, formatting, linting, typechecking, testing and build scripts;
- ignore protections for CSV, database, Parquet, DuckDB, secrets and private generated analytics; and
- Preview-disabled and Production-fail-closed deployment controls.

## Architecture rationale

Large private files and multi-million-row computation are separated from normal web requests. R2 retains private versioned source/analytical objects; an ephemeral worker validates and precomputes; Neon serves compact owner-scoped application state and aggregates; Vercel renders the private UI. This preserves auditability and online-only operation without forcing full-history scans on page requests.

## Analytical integrity carried into the scaffold

- `gold_star` and `blue_star` are nullable normalized facts with raw provenance reserved.
- Gold eligibility is derived from `gate_count > 3`.
- Ineligible races cannot become negative Gold evidence.
- Event-level multiple assignments and ineligible Gold assignments are warnings, not silent rewrites.
- Historical field quality is designed as an event-time/as-of feature, separated from conversion diagnostics.
- Open Race Stage A has no current-star input; Stage B is locked, optional and observation-only.
- Freshness separates `Data current through`, `Last imported`, age and status.
- No imported snapshot is described as live.

## Economic integrity carried into the scaffold

- exact integer/decimal storage rather than binary floating point;
- asset/currency totals remain separate;
- BGC remains non-cash by default;
- transfers and opening balances are excluded from operating P/L;
- conversions require a dated source and preserve original amounts;
- race derivations use stable duplicate-resistant keys;
- manual corrections use auditable reversal/reconciliation concepts; and
- no private key, seed phrase or signing credential is requested or stored.

## Validation

Remote validation completed successfully:

- `npm run format` — passed;
- `npm run lint` — passed with no warnings;
- `npm run typecheck` — passed in strict mode;
- `npm test` — 6 files and 22 tests passed;
- `npm run build` — passed; all 13 product routes plus `robots.txt` generated;
- simulated Vercel Production build — rejected as required with the Gate F message;
- Preview with `ENABLE_PHASE0_REVIEW=false` — returned HTTP 404; and
- explicitly enabled Preview — returned HTTP 200 and the Phase 0 dashboard shell.

CI independently repeats formatting, lint, strict typecheck, unit tests and the Production-disabled build.

## Known limitations and deferred work

- No real export is uploaded to any hosted provider in Phase 0.
- Clerk, Neon, R2 and Vercel account configuration is intentionally not performed before Gate A.
- The scaffold has no anonymous/demo mode and remains inaccessible on Vercel until Preview protection is configured and explicitly enabled.
- Schema/migrations, import processing and persistent auth begin only after Gate A in Phase 1.
- Analytics functions beyond invariant foundations are not implemented and no predictive-success claim is made.
- Vault Performance contains no transactions or totals until validated source and manual-entry paths exist.
- Source fee semantics remain unconfirmed and cannot create dependable P/L before Gate B.
- Retention periods are proposed, not activated.

## Expected cost

Phase 0: **US$0**.

Initial Preview operation is intended to remain within free tiers. Current provider limits and paid triggers are recorded in `docs/ARCHITECTURE.md`. No paid plan or recurring billing is approved.

## Gate A decision requested

Accept or amend:

1. Clerk authentication plus one-user allowlisting;
2. Neon for application state and durable aggregates;
3. private Cloudflare R2 for raw and analytical objects;
4. hosted ephemeral Python/Polars/DuckDB batch processing;
5. the star, chronological no-leakage, Open Race and freshness models;
6. exact asset-separated ledger and BGC treatment;
7. the retention/deletion proposal; and
8. Preview-only, Production-fail-closed delivery.

No account action is required merely to review this PR. After Gate A acceptance, Phase 1 will identify the exact Preview account actions and secrets required before any synthetic hosted integration. Full private data remains blocked until Gate B.
