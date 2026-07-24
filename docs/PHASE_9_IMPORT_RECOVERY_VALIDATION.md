# Phase 9 Import Recovery Validation

This contract audits recovery evidence without executing a rollback. It requires
one active accepted batch, keeps a quarantined latest attempt isolated, permits
only a prior same-owner/source rollback target with a recorded reason and
requires exact replay to resolve the existing version without new
contributions.

Batch and contribution provenance must remain retained. Aggregates must either
be refreshed after recovery or carry explicit proof that no refresh is
required. Carrying an old aggregate completion state forward is blocked.

The contract cannot delete source evidence, mutate Production, execute a
rollback or accept Gate B. Synthetic fixtures establish only deterministic
validation behaviour.
