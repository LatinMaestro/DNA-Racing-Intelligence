# Integration Composition Plan

## Boundary

The approved Build Plan ends at Phase 9. This plan composes already staged work and does not create a Phase 10, enable recommendations, accept a review gate or change Production.

## Conflict audit

All nine phase integration branches are directly ahead of `e1b10b90d7a54e8a116f4f0e7b89bd8f3abdf49a` and zero commits behind it at the recorded audit.

The only path changed by more than one phase integration branch is:

- `docs/DECISION_LOG.md`

All 210 domain, synthetic-test and phase-specification paths are unique across phases. Decision-log additions are append-only and must be composed in the phase order below.

## Actions-return queue

1. **Restore test discovery — PR #29**
   - Confirm its head is unchanged.
   - Run full exact-head CI, including TS and TSX tests, lint, formatting, strict typecheck, application build and reversible migration checks.
   - Require at least the previously stated 15 files / 94 tests before considering merge.
   - Review the complete diff and merge only if every required check passes.

2. **Establish current Vault ownership — PR #28**
   - Rebase or refresh onto the verified post-#29 `main`.
   - Resolve only genuine integration differences.
   - Run the complete exact-head gate and review ownership, Maiden-state and freshness boundaries.
   - Merge only after exact-head CI passes.

3. **Phase 2 analytics**
   - Re-anchor `agent/integrate-phase-2-analytics` onto the new `main`.
   - Preserve all six contract bytes and compose its decision-log sections after the existing log.
   - Run complete exact-head CI and merge only after review.

4. **Phase 2A accounting**
   - Re-anchor `agent/integrate-phase-2a-accounting` onto verified `main`.
   - Reconfirm asset separation, BGC separation, transfer exclusion, duplicate handling, missing-cost-basis behaviour and partial-report wording.
   - Run complete exact-head CI and merge only after review.

5. **Phase 3 Discovery**
   - Re-anchor `agent/integrate-phase-3-discovery`.
   - Reconfirm mode/exact-distance separation, minimum-10 status, lineage order, no-leakage cutoffs and no-star supporting-only treatment.
   - Run complete exact-head CI and merge only after review.

6. **Phase 4 tournament**
   - Re-anchor `agent/integrate-phase-4-tournament`.
   - Reconfirm configurable metrics, qualification-only control, 50% as a cap rather than a target, campaign accounting and payout reconciliation.
   - Run complete exact-head CI and merge only after review.

7. **Phase 5 Maiden**
   - Re-anchor `agent/integrate-phase-5-maiden`.
   - Reconfirm cross-mode opportunity cost, preserve-ME outcomes, bracket suitability, commitment warnings and time-primary evidence.
   - Run complete exact-head CI and merge only after review.

8. **Phase 6 breeding**
   - Re-anchor `agent/integrate-phase-6-breeding`.
   - Reconfirm class, element, F-number, family, cycle, fee, arena-freshness and three-ranking separation.
   - Run complete exact-head CI and merge only after review.

9. **Phase 7 lifecycle**
   - Re-anchor `agent/integrate-phase-7-lifecycle`.
   - Reconfirm Genesis burn prohibition, unresolved-evidence protection, sale/cost-basis handling and burn-credit separation.
   - Run complete exact-head CI and merge only after review.

10. **Phase 8 Open Race**
    - Re-anchor `agent/integrate-phase-8-open-race`.
    - Reconfirm current-race stars are unavailable before entry, field lock is irreversible and post-lock capture remains observation-only.
    - Run complete exact-head CI and merge only after review.

11. **Phase 9 validation**
    - Re-anchor `agent/integrate-phase-9-validation`.
    - Run the complete exact-head gate and use the contracts to collect representative evidence.
    - Do not treat synthetic audit-contract tests as real calibration, capacity, security or Production-readiness proof.

12. **Representative evidence and gates**
    - After the code is integrated, complete the approved private Preview provider/account actions and representative import only under Gate B controls.
    - Collect chronological holdout, calibration, economic reconciliation, performance, recovery, accessibility and security evidence.
    - Record Gates B–E only when their exact requirements are actually satisfied.
    - Keep Gate F client-only and Production fail-closed.

## Per-branch composition procedure

For every integration branch:

1. Verify `main`, PR state and the recorded source head before writing.
2. Rebase or rebuild from the latest verified `main`; do not force-update shared history.
3. Compare all unique files byte-for-byte with the recorded integration head.
4. Append that phase's decision-log sections in order.
5. Run hosted-workspace checks before opening the PR.
6. Open one focused draft PR for the phase.
7. Run mandatory exact-head GitHub CI.
8. Review the complete diff, CI and gate wording.
9. Merge only under the repository's standing authority and only when all requirements pass.
10. Verify merged `main` before starting the next dependent phase.

## Failure handling

- A runner-allocation failure is not a test failure and is not acceptance evidence; rerun only after capacity is confirmed.
- A real code, type, lint, build, migration, security or test failure blocks that phase and every dependent phase.
- Do not bypass a failed gate by combining phases into a larger PR.
- Do not activate providers, use private data, incur paid usage or change Production to resolve a repository-only failure.
