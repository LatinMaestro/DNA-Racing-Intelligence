# Phase 9 offline merge readiness

Status: synthetic, non-executable no-Actions evidence.

## Purpose

The offline queue is a dependency-ordered handoff, not permission to merge.
This projection validates the evidence needed to carry its focused branches to
future exact-head CI without opening a pull request, dispatching a workflow or
changing Production.

## Queue contract

Each entry supplies:

- a unique positive order;
- a focused `agent/` branch;
- the queued 40-character lowercase commit SHA;
- the observed remote head, or an explicit unverified state;
- merge-candidate or non-merge-precursor disposition;
- the prior merge-candidate dependency;
- hosted validation state; and
- workflow-run, status-context and pull-request counts.

Merge candidates must form one strict chain. A non-merge precursor remains
auditable but is excluded from the eventual PR sequence. The next candidate
after a precursor must depend on the prior actual merge candidate.

An unverified head or unrun hosted validation remains review-required. A head
mismatch, failed validation, broken dependency or any workflow, status or pull
request on a no-Actions staging branch blocks readiness.

## Global controls

The projection also blocks unless:

- Production remains disabled;
- providers remain unchanged;
- no private source data entered Git;
- no public route is exposed; and
- no recurring paid infrastructure is enabled.

Malformed identities, branch names, SHAs, counts, dispositions, evidence states
or boolean controls are rejected rather than coerced.

## Output boundary

A complete projection may reach `ready_for_exact_head_ci`, meaning only that
the staged chain is ready to wait for Actions capacity. It always returns:

- `mergeAllowed: false`;
- `workflowDispatchAllowed: false`; and
- `productionMutationAllowed: false`.

After capacity returns, every candidate still requires rebase onto the newly
merged `main`, complete diff review, privacy scanning, formatting, lint, strict
types, all TS/TSX tests, build, reversible migration checks where applicable
and successful exact-head GitHub Actions before a focused merge.

Provider connection, private Preview import, Gate acceptance and Production
activation remain separate evidence and client-approval boundaries.
