# Phase 9 exact-head Actions progress

Status: non-executable sequencing evidence for use after Actions capacity is
explicitly available.

## Purpose

This evaluator consumes the reviewed static exact-head plan and current,
head-bound evidence to return one deterministic next step. It does not rebase,
dispatch a workflow, open or update a pull request, merge a branch, change a
provider or mutate Production.

## Preconditions

- The offline merge-readiness projection must pass.
- Production must remain disabled.
- Actions capacity must be explicitly available before any rebase or dispatch
  step is projected.
- Non-merge precursors remain in audit history but are excluded from the merge
  candidate sequence.
- Every candidate must depend on the immediately prior actual merge candidate.
- Candidate order, branch, queued head and precursor exclusions must match the
  static plan exactly.

## Per-candidate order

For the first unmerged candidate:

1. rebase onto the current `main`;
2. run formatting, lint, strict types, all TS/TSX tests, build, production
   dependency audit and privacy scans on that rebased head;
3. apply, smoke-test and reverse applicable PostgreSQL migrations on an
   approved non-Production target;
4. review the complete exact diff, append-only decisions, privacy boundary and
   limitations;
5. resolve every review thread on that exact head;
6. run mandatory GitHub Actions on the exact reviewed head;
7. record readiness for a separate focused merge decision; and
8. after an independently authorized merge, verify the resulting exact `main`
   head before advancing.

The sequence stops on the first current-head failure. A later candidate cannot
be recorded as merged while a dependency remains unmerged.

## Head invalidation

Every validation result, migration result, diff review, review-resolution result
and CI result is bound to one exact commit SHA. Post-merge verification is bound
to the resulting exact `main` SHA. Rebasing or otherwise changing the branch
head makes all evidence from an older SHA stale. Stale success never passes a
later head.

## Output boundary

Before Actions capacity returns, the only valid next step is to wait. After all
current-head evidence passes, the status is `ready_for_focused_merge`, not
merged. Every result permanently returns:

- `mergeAllowed: false`;
- `workflowDispatchAllowed: false`; and
- `productionMutationAllowed: false`.

The projection cannot accept Gate F, enable Production or replace the
repository's exact-head review and merge controls.
