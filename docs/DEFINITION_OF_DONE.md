# Definition of Done

A phase or feature is complete only when all applicable items pass.

## Functional

- Meets the accepted specification and confirmed rules.
- Handles empty, partial, malformed and stale data safely.
- Produces explainable output with evidence and confidence.
- Does not rely on the obsolete race-class field.
- Does not expose private data publicly.
- Vault Performance totals drill down to source or manual ledger entries.

## Data

- Import is validated, idempotent and auditable.
- Duplicate and conflict behaviour is tested.
- Provenance is retained.
- Rollback or safe recovery is documented and tested.
- Real user data is absent from Git history and test fixtures.
- Financial quantities use decimal-safe storage and calculations.
- Race-derived and manual financial records remain distinguishable.
- Ledger corrections preserve history through safe adjustments or reversals where practical.

## Analytics

- Features are documented.
- Time direction and normalization are correct.
- Bike, car and horse remain separated.
- Sample size and uncertainty are displayed.
- Chronological holdout testing prevents leakage.
- Results are compared with simple baselines.
- Unsupported causal or deterministic claims are absent.
- Financial performance does not replace time/speed evidence in racing-quality recommendations.

## Financial ledger

- Open racing, tournament qualification, automatic rounds, grand finals and manual tournament awards are separately reportable.
- Native-currency entry fees, payouts and net calculations are correct.
- Unlike currencies are not silently combined.
- Optional conversions retain rate, source and effective date.
- BGC receipts and spending maintain a separate balance and are excluded from cash/crypto profit by default.
- Manual tournament award allocation preserves the original transaction total.
- Arena listings are not recognised as income without an actual receipt record.
- Possible manual/export duplicates are surfaced and cannot be silently deleted.
- Missing cost basis, unclassified activity and unconverted values produce visible warnings.
- Per-core, per-tournament and time-range drill-downs reconcile to the ledger.

## Rules

- Confirmed game rules have automated tests.
- Maiden lifecycle and preserve-ME logic are tested.
- Tournament configuration supports variable qualification rules.
- 50% gate occupancy is enforced as a cap, not a target.
- Breeding class, lower-element, F-number, family, cycle and fee rules are tested.
- Genesis burn exclusion is tested.

## Engineering

- TypeScript strict mode passes.
- Lint, typecheck, unit and integration tests pass.
- Relevant end-to-end paths pass.
- Database migrations are reviewed and reversible where practical.
- Large-history processing is not performed synchronously on routine page requests.
- Accessibility and responsive behaviour are checked.
- Security-sensitive values, wallet references and private transaction details are not logged.

## Delivery

- PR has a clear scope and summary.
- Changed files are focused.
- Validation commands and results are recorded.
- Known limitations and deferred work are documented.
- Documentation is updated with code.
- Review gate status is stated.
- Production is unchanged unless explicitly approved.