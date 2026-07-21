# Definition of Done

A phase or feature is complete only when all applicable items pass.

## Functional

- Meets the accepted specification and confirmed rules.
- Handles empty, partial, malformed and stale data safely.
- Produces explainable output with evidence and confidence.
- Does not rely on the obsolete race-class field.
- Does not expose private data publicly.
- Gold/Blue star outputs show counts, eligibility, denominator, mode/distance context, field context and data coverage.
- Race-derived views show `Data current through`, `Last imported` and freshness status and do not imply live data.
- Open Race selection works without current-race star inputs.
- Open Race post-lock star capture, where implemented, is clearly observation-only and cannot produce a replacement-core recommendation.
- Vault Performance reports clearly separate currencies/assets and distinguish complete, partial and estimated results.

## Data

- Import is validated, idempotent and auditable.
- Duplicate and conflict behaviour is tested.
- Provenance is retained.
- Rollback or safe recovery is documented and tested.
- Real user data is absent from Git history and test fixtures.
- Raw and normalized `gold_star` and `blue_star` values are preserved where supplied.
- False, missing, partial, invalid and Gold-ineligible states remain distinguishable.
- `gold_star_eligible` is false for gate counts of one, two and three.
- A source Gold assignment at three gates or fewer is retained and flagged as an anomaly.
- Event-level multiple-assignment anomalies are surfaced rather than silently rewritten.
- Star aggregates remain idempotent across cumulative imports.
- Optional manual post-lock star observations remain separate from imported race facts until reconciled.
- Reconciliation with a later authoritative event cannot duplicate star counts or analytical evidence.
- Import timestamp, latest accepted event timestamp and aggregate refresh timestamp are retained.
- Race-derived economic transactions remain idempotent across cumulative imports.
- Manual transactions, corrections, reversals and exclusions retain audit history.
- Exact monetary/token/BGC values are stored without binary floating-point error.

## Analytics

- Features are documented.
- Time direction and normalization are correct.
- Bike, car and horse remain separated.
- Sample size and uncertainty are displayed.
- Chronological holdout testing prevents leakage.
- Historical star field quality uses only information available before the event.
- Current-event outcomes and later races cannot leak into star-strength features.
- One-, two- and three-gate races never count as negative Gold evidence.
- Gold/Blue predictive lift is compared with time-only and simple baselines.
- Star conversion diagnostics remain separate from pre-race predictive features.
- Detected star-assignment era changes are documented or explicitly reported as not detected.
- No-star evidence alone cannot stop Discovery, label a core as poor or recommend burn.
- Current-race stars are not used in an Open Race pre-entry recommendation because they are unavailable at selection time.
- Post-lock star observations are not misrepresented as pre-entry predictive inputs or completed outcomes.
- Dataset freshness is incorporated into confidence and warnings without changing accepted historical facts.
- Results are compared with simple baselines.
- Unsupported causal, inherited-trait or deterministic claims are absent.

## Accounting and economic reporting

- Entry fees and payouts use validated source semantics.
- Open racing, qualification, automated rounds and finals can be separated or left explicitly unclassified.
- Manual external tournament payouts can be linked and reconciled without double counting.
- Unlike currencies/assets are not silently combined.
- BGC is separate from cash/crypto P/L by default.
- Deposits, withdrawals and internal transfers are excluded from operating P/L.
- Arena listings are not treated as completed breeding income.
- Core sale profit is unavailable when cost basis is missing rather than fabricated.
- Unsold-core valuations are excluded from realised P/L by default.
- Reports show coverage, current-through date, unclassified records, missing cost basis, conversion use and reconciliation issues.
- Duplicate detection and reversal paths are tested.
- No crypto private keys, seed phrases or signing credentials are requested or stored.

## Rules

- Confirmed game rules have automated tests.
- Gold means strongest assessed top-three chance and Blue means strongest assessed first-place chance in the entered field.
- Gold is unavailable at three gates or fewer.
- Stars are treated as field-relative pre-race signals, not guaranteed outcomes or absolute ratings.
- Open Race stars are revealed only after all gates are filled and the race is set to run.
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
- Star-profile and field-quality aggregates are precomputed or otherwise efficiently served.
- Imported-data pages are tested for freshness and non-live wording.
- Open Race stage transitions and observation reconciliation are tested.
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
