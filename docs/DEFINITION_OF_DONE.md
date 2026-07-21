# Definition of Done

A phase or feature is complete only when all applicable items pass.

## Functional

- Meets the accepted specification and confirmed rules.
- Handles empty, partial, malformed and stale data safely.
- Produces explainable output with evidence and confidence.
- Does not rely on the obsolete race-class field.
- Does not expose private data publicly.

## Data

- Import is validated, idempotent and auditable.
- Duplicate and conflict behaviour is tested.
- Provenance is retained.
- Rollback or safe recovery is documented and tested.
- Real user data is absent from Git history and test fixtures.

## Analytics

- Features are documented.
- Time direction and normalization are correct.
- Bike, car and horse remain separated.
- Sample size and uncertainty are displayed.
- Chronological holdout testing prevents leakage.
- Results are compared with simple baselines.
- Unsupported causal or deterministic claims are absent.

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
- Security-sensitive values are not logged.

## Delivery

- PR has a clear scope and summary.
- Changed files are focused.
- Validation commands and results are recorded.
- Known limitations and deferred work are documented.
- Documentation is updated with code.
- Review gate status is stated.
- Production is unchanged unless explicitly approved.
