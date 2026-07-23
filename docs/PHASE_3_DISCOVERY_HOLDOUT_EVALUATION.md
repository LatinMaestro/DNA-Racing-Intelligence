# Phase 3 Discovery Holdout Evaluation

This contract evaluates chronological competitive-time predictions from a
time-plus-star candidate against a time-only baseline.

## Boundaries

- Training cutoff, holdout start and holdout end are strictly ordered.
- Every feature cutoff must be strictly earlier than its event.
- Events must fall inside the declared holdout window.
- Authoritative event and core IDs prevent duplicate race-entry evidence, while
  mode and exact distance remain separate reporting cells.
- Brier score, incremental lift, calibration gap, sample size and star-feature
  coverage remain visible overall and by exact mode/distance cell.
- Candidate improvement is evidence for review only. Synthetic results cannot
  establish real analytical performance or self-pass Gate C.
- No output enables an actionable Discovery recommendation.

## Verification

Synthetic tests cover baseline comparison, Gate C immutability, leakage,
holdout boundaries, insufficient and partial samples, exact-cell separation,
no-lift behaviour, duplicate/runtime rejection and configuration ordering.
