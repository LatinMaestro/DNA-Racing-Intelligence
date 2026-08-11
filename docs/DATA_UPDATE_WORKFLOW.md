# Periodic Data Update Workflow

## Purpose

The website database is refreshed by uploading newer DNA Racing exports through the private authenticated **Data Updates** workspace. The owner does not edit database tables and does not need to replace files in GitHub.

The normal owner task is:

1. download the latest exports from the DNA Racing file share;
2. open **Data Updates** in the private website;
3. drag in one or more files;
4. review the detected update plan;
5. confirm the import; and
6. wait for the completion summary before relying on refreshed recommendations.

The upload feature is an approved implementation contract. It remains unavailable until the Preview-only identity, private object storage and database configuration satisfy Gate B. Production remains separately gated.

## What to upload

| Source family            | When to upload                                                                                                       | Update treatment                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Race Merge               | Add every new sequential export. Several files may be uploaded together. Re-uploading an earlier file is safe.       | Append accepted entries in event-time order, retain prior history, ignore exact replay and boundary duplicates, quarantine conflicting facts and refresh only affected aggregates.          |
| Core Details and lineage | Upload the latest export whenever DNA publishes meaningful identity, attribute, parentage or new-core updates.       | Versioned upsert by authoritative durable core ID. Omitted older cores are not silently deleted, and parent relationships are never inferred from names.                                    |
| My Vault                 | Maintain ownership and Maiden eligibility directly in the authenticated Vault workspace. The retired Current Vault spreadsheet is reference-only and is not uploaded. | Owner-maintained state keyed to durable Core ID; removing an active core retains its historical racing, lineage, lifecycle, breeding and economic evidence. |
| Current Arena            | Upload before relying on current external breeding options and whenever a newer listing snapshot is available.       | Replace the current listing snapshot while retaining earlier snapshots. Listings absent from the accepted replacement are no longer current; freshness and expiry warnings remain visible.  |

Race Merge is the only source family that normally grows by adding more files. Core Details is cumulative/upserted, while Vault and Arena are current replacement snapshots.

## Upload and preview experience

The owner may upload the three imported source families individually or together. The number of Race Merge files is variable because the series grows over time. The workspace detects the file family from its headers, while allowing an explicit source choice only when the headers also match.

Before any active dataset changes, the preview shows:

- filename inside the authenticated owner workspace;
- detected source family, schema version and encoding;
- source and accepted row counts;
- event or snapshot date coverage where available;
- new, exact-duplicate, conflicting, rejected and warning counts;
- the active dataset version that would be superseded;
- current My Vault and Maiden-state impact, without treating the retired Current Vault spreadsheet as an import source;
- Core Details and lineage coverage changes;
- Arena identity/history coverage and freshness;
- historical BGC race rows that will retain performance evidence with zero effective fee and payout;
- aggregates and analytical profiles that will be refreshed; and
- projected storage or processing usage, including a stop-before-paid-limit warning.

Authenticated row-level error details may be shown to the owner when needed to correct or understand a source problem. Raw values must not be printed to routine application logs, CI output, GitHub, public routes or unauthenticated error pages.

The preview does not mutate the active dataset. The user confirms the displayed plan before processing begins.

## Processing and atomicity

Each file is processed as an auditable import batch. A multi-file upload is one update session, but each source file retains its own status and rollback boundary.

For each accepted file, the background process:

1. stores the original upload privately with checksum and import metadata;
2. detects schema and encoding;
3. validates and normalizes rows without discarding the source values;
4. compares natural keys and fingerprints with accepted history;
5. quarantines malformed or conflicting records without overwriting accepted facts;
6. activates the new source version only after its transaction succeeds;
7. derives or refreshes affected facts, exact economics and compact aggregates;
8. records data-current-through, import-completion and aggregate-refresh timestamps separately; and
9. publishes a completion report.

If processing fails before activation, the previous accepted dataset remains current. A failed or quarantined newer upload cannot make the site appear fresher than its accepted data.

Race Merge files uploaded together are ordered by event coverage. Older backfills are allowed when they add non-conflicting history. Exact replays and the known small boundary overlaps are idempotent.

## Completion report

The owner receives a private completion result showing:

- accepted, duplicate, quarantined and conflict counts;
- source coverage and any explicit gaps;
- the active version for each source family;
- **Data current through**;
- **Last imported**;
- aggregate refresh completion;
- current, ageing, stale or unknown status;
- economic coverage and any missing historical USD rates;
- unresolved review items; and
- whether recommendations and reports are ready to use or remain partial/experimental.

The website must not silently present refreshed recommendations until the required aggregate refresh succeeds.

## Recovery

The owner can inspect import history and:

- roll back one accepted source version with a recorded reason;
- restore the prior Arena snapshot; owner-maintained Vault changes use their guarded versioned mutation history;
- review and resolve genuine identity or conflict issues;
- retry aggregate processing without re-uploading the source file; and
- re-upload a corrected export safely.

Rollback preserves the uploaded object, accepted provenance and audit record unless the owner separately invokes an explicit deletion workflow. It does not rewrite Git history.

## Analytical fidelity and data retention

This is a private, single-user analytical website. Source selection and field retention must maximise analytical quality and auditability.

- Do not remove or suppress a source field merely because it might be personal, identifiable or sensitive.
- Preserve each original uploaded file in the private raw-data boundary and retain its source columns and values for provenance, reproducibility and future feature development, subject to approved capacity limits.
- Normalize and index every field that is required or plausibly useful for current analytics, recommendations, identity, lineage, accounting, freshness, reconciliation or validation.
- A field may be omitted from compact application tables when it is redundant or currently unused, provided it remains recoverable from the private raw source and the omission cannot reduce current analysis.
- Preserve unknown new columns in raw provenance and surface a schema warning so their usefulness can be assessed.
- Preserve obsolete race class for provenance while excluding it from analytical models.
- Redaction applies to Git, automated logs, public surfaces and synthetic fixtures. It must not reduce the data available to authenticated owner workflows or private analytical processing.
- Real exports and derived user-specific records remain outside Git because Git is source-code history, not the private website data store.

DNA Racing source exports and observable game ownership are public game data, not confidential records. Authentication and ordinary infrastructure security remain required to prevent unauthorised writes, protect service credentials and keep the single-owner application reliable.

## Source changes

The owner should not manually reshape a normal export to fit the website. If DNA Racing changes a header, encoding or field format beyond a supported schema version, the importer must fail closed, keep the last accepted dataset active and show a clear unsupported-schema review item. The implementation is then updated with a versioned adapter and synthetic regression coverage before that source is accepted.

## Acceptance requirements

The implemented workflow is complete when synthetic and hosted Preview evidence demonstrates:

- one owner can upload any supported source family without local development;
- grouped multi-file previews are accurate before mutation;
- exact replay is a no-op;
- sequential Race Merge additions and older backfills are idempotent;
- conflicting Race Merge facts cannot overwrite accepted history;
- Core Details upserts preserve durable identity and lineage provenance;
- Arena replacements retain historical snapshots and rollback, while owner-maintained Vault changes retain versioned history;
- the retired Current Vault spreadsheet is rejected as an import source;
- owner-authenticated error review can show useful exact details without logging them;
- all analytically relevant source fields remain available inside the private data boundary;
- aggregate refresh and freshness states are accurate;
- historical BGC races contribute performance but no economics;
- failure and rollback preserve the previous accepted state;
- usage checks stop before an unapproved paid threshold; and
- Production remains disabled until Gate F approval.
