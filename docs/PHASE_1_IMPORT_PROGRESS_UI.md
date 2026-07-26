# Import Progress and Completion UI

## Purpose

Provide the authenticated owner with a compact historical-snapshot projection of
recent import progress, completion readiness and recoverable states without
activating providers or trusting browser-supplied import evidence.

## Projection boundary

- Derive progress only from the validated owner-scoped import-batch read model.
- Keep received, validation, accepted activation, aggregate publication and
  historical-view readiness as separate stages.
- A received or validating batch cannot advance accepted-data freshness.
- A quarantined attempt remains blocked and cannot replace the active accepted
  source version.
- Accepted data remains not ready while aggregate refresh is pending.
- A published aggregate remains review-required when rejected rows, identity
  review or observation reconciliation remain.
- A rolled-back batch is shown as recovered evidence, not as current or ready.

## Interface boundary

- Render as a Server Component with no browser state, provider SDK or request-time
  raw-history scan.
- Show count-only accepted, quarantined and warning totals.
- Keep `Data current through`, `Last imported` and aggregate refresh time
  separate.
- Do not expose batch IDs, filenames, rows, source values or private review
  details in routine markup.
- Keep upload, confirmation, aggregate retry and rollback controls visibly
  disabled until approved owner-scoped provider adapters are configured.
- Never describe imported evidence as live game state.

## Validation

Synthetic coverage verifies ready, aggregate-pending, quarantined,
review-required, rolled-back, empty and unsafe-evidence cases. Component
rendering verifies semantic headings, disabled actions, timestamp separation and
absence of durable batch IDs or affirmative live-data wording.

This slice does not configure persistence, object storage, queues, incremental
hashing, Preview imports or Production.
