# Phase 1 Import and Recovery UI Contract

## Scope

This slice replaces the Imports placeholder with an accessible provider-independent workspace for historical source status, batch coverage and recovery/review queues. It defines the typed projection that a later authenticated server loader will populate from the owner-scoped database.

No private upload endpoint or provider credential is enabled. The page explicitly states that private upload is unavailable until approved Preview-only identity, database and object-storage services are configured. Production remains fail-closed.

## Source status

Race Merge, Core Details, Current Vault and Current Arena each expose:

- latest import-attempt status;
- active accepted batch, when one exists;
- data current-through separately from last imported;
- aggregate refresh separately from both import timestamps;
- current, ageing, stale or unknown freshness; and
- accepted, rejected and warning counts.

A newer quarantined attempt does not replace the active historical dataset or its freshness. Missing source data remains `not imported / unknown`; the UI does not invent a successful import or live state.

## Recovery and review

The projection creates explicit owner-only queue items for:

- a reasoned rollback when a prior accepted version exists;
- unresolved Vault/Arena identity review;
- manual star-observation reconciliation review; and
- an accepted dataset whose aggregate refresh is still pending.

Only active accepted batches create recovery items. Rolled-back or historical batches remain visible as provenance but cannot create active actions.

## Privacy boundary

Routine summaries contain only source type, state, timestamps, counts and stable issue codes. Redacted summaries exclude batch IDs, filenames, raw headers, names and row values. Private batch IDs may appear only inside the authenticated owner workspace when later loaded from the database.

Synthetic tests cover empty/unknown state, quarantined-attempt separation, freshness, queue construction, impossible coverage, multiple-active-version rejection and redacted output. No real CSV, private row, provider account, secret or hosted data is used.
