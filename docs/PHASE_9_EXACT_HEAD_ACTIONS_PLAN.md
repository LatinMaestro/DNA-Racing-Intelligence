# Phase 9 exact-head Actions plan

Status: synthetic, non-executable pre-capacity evidence.

## Purpose

The offline merge queue contains focused dependency-ordered candidates, but it
does not authorise a workflow run or merge. This contract converts a verified
offline-readiness assessment into the serial preflight sequence required after
GitHub Actions capacity returns.

## Inputs

The plan requires:

- the complete offline-readiness evidence, including exact remote heads;
- the currently verified `main` SHA;
- explicit Actions-capacity availability;
- the merge-candidate orders that require reversible migration verification;
  and
- any existing pull-request numbers, such as the two current prerequisites.

Migration and pull-request metadata may reference merge candidates only.
Non-merge precursors remain auditable but are excluded from execution.

## Serial execution

Each merge candidate is one step. The first step must start from the verified
current `main`; every later step starts only after the preceding merge
candidate is merged and the new `main` is verified.

Every step requires:

1. rebase or recompose onto the verified current `main`;
2. reconcile append-only shared documents;
3. run formatting, ESLint, strict TypeScript, all TS/TSX tests, the optimized
   build, dependency audit and privacy scan;
4. for migration-bearing candidates, apply, smoke-test, reverse and verify
   removal in the approved ephemeral PostgreSQL environment;
5. create or update only the focused pull request for that candidate;
6. require successful GitHub Actions on the exact rebased head;
7. review the complete exact diff and resolve every review thread;
8. merge only after the repository's standing authority and all gates apply;
   and
9. verify the resulting `main` before starting the next candidate.

A rebase, amendment or other head change invalidates prior exact-head CI and
requires the complete applicable evidence again. A failed check, unresolved
thread, privacy issue, migration failure or unexpected provider/Production
change stops the sequence at that candidate.

## Capacity boundary

Before capacity returns, the plan reports `awaiting_actions_capacity`. After
explicit capacity evidence, it may report `ready_to_start_preflight`.

Both states remain non-executable evidence:

- `executionAuthorized: false`;
- `workflowDispatchAuthorized: false`; and
- `productionMutationAuthorized: false`.

The automation must re-establish live repository truth before acting. This
document does not dispatch a workflow, open or update a pull request, merge a
branch, configure a provider, accept Gate F or mutate Production.
