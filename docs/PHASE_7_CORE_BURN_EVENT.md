# Phase 7 Core-Burn Event

## Purpose

Record evidence that an irreversible burn has already occurred without allowing
the lifecycle adviser to execute a burn or predict its BGC return.

## Contract

- Permanently reject Genesis burn evidence.
- Require confirmed completed evidence and confirmed active ownership at the
  event time before proposing removal from the active Vault.
- Retain the burnt core in historical lineage.
- Hold provisional, conflicted or ownership-uncertain evidence for review.
- Keep the actual burn event separate from any later BGC credit evidence.

## Boundaries

The contract cannot burn a core, mutate ownership or post a ledger entry. A
prior burn recommendation is never proof of execution. The output contains no
predicted burn-credit amount.
