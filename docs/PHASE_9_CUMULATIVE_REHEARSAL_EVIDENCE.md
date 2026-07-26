# Phase 9 cumulative rehearsal evidence

Status: fail-closed evidence boundary for the cumulative no-Actions rehearsal.

## Purpose

The evaluator records whether the latest dependency-ordered composition has
current exact-head evidence for:

- dependency and shared-document reconciliation;
- formatting, linting and strict TypeScript;
- every TS/TSX test;
- the production build and dependency audit;
- privacy scanning; and
- synthetic import, replay, rollback and reconciliation.

Missing checks require review. Failed checks, stale evidence or a composition
that is not the latest merge candidate block the rehearsal.

## PostgreSQL boundary

Migration evidence passes only when one exact-head non-Production run records
apply, smoke, reverse and removal success. An unavailable PostgreSQL runtime is
reported as unavailable rather than converted into false success or failure.

## Permanent limitations

Even complete offline evidence still requires:

- connected forced-owner-RLS Preview and provider evidence;
- exact-head GitHub Actions after capacity returns; and
- the repository's separate review and merge controls.

The evaluator cannot dispatch a workflow, open or merge a pull request, change
a provider or mutate Production.
