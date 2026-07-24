# Offline Integration Rehearsal

## Scope

The validated rehearsal composes, in dependency order:

1. PR #29's TSX component-test discovery prerequisite;
2. PR #28's confirmed-ID Vault registry prerequisite;
3. the verified offline source-contract, recurring-update, real-file compatibility, Vault identity, historical BGC and Core source-coverage work;
4. every unique file from the canonical Phase 2 analytics and Phase 2A accounting integration tips; and
5. every unique file from the canonical Phase 3–9 integration tips.

The composition contains 352 repository files. The 210 phase files were
additions with no cross-phase or offline-branch path collision.
`docs/DECISION_LOG.md` was the only shared phase path; each phase branch
extended the same `main` version, so its appended sections were retained in
canonical phase order. PR #28's decision section and README link were composed
without replacing later source-contract additions.

No private source file, identity, individual record or monetary value entered the rehearsal.

## Integration defect found and resolved

The real-source compatibility correction initially widened the shared exact-decimal parser to accept base-10 scientific notation everywhere. That was correct for a small set of historical Race Merge source fees but incorrectly allowed scientific notation through three Phase 2A manual and reporting boundaries.

The rehearsal resolved the conflict by separating the contracts:

- `normalizeSourceExactDecimal` accepts bounded exact scientific notation only at the Race Merge source boundary and immediately returns a plain exact decimal;
- `normalizeExactDecimal` continues to accept plain base-10 decimals only;
- manual ledger, reconciliation, reporting, valuation and downstream arithmetic boundaries remain fail-closed on scientific notation; and
- neither path uses binary floating point.

The focused regression verifies both the accepted historical source form and the rejected manual form.

## Hosted validation

The exact composed file state was materialized from GitHub blobs and every local blob SHA was checked before validation.

The following repository commands passed:

- `npm ci` from the committed lockfile using a disposable cache;
- `npm run format`;
- `npm run lint`;
- `npm run typecheck`;
- `npm test`; and
- `npm run build`.

Observed final results:

- 88 Vitest files passed;
- 774 tests passed, including the TSX component suites and current-Vault
  registry;
- the optimized Next.js build compiled and completed TypeScript checks; and
- 14 static pages were generated across the private application routes and framework pages.

## Remaining evidence boundary

This rehearsal does not replace mandatory exact-head GitHub Actions evidence before merge.

PostgreSQL migration apply, smoke, reversal and removal checks were not
executed because this hosted workspace has no PostgreSQL runtime. All nine
ordered migration sets contain up, smoke and down scripts. Those scripts must
still pass in the approved ephemeral PostgreSQL environment before any affected
migration is merged.

The repository privacy scan found no committed CSV, spreadsheet, archive,
database or dump files; no real export filenames; and no secret-like material.
CSV references in tests and migration smoke scripts are explicitly synthetic.

The branch does not configure Preview providers, persist private source data, open a pull request, change `main` or activate Production.
