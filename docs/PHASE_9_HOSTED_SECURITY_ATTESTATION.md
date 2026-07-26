# Phase 9 hosted security attestations

Status: synthetic, non-executable evidence contract.

## Purpose

Bind every mandatory security and privacy control to one exact candidate head
and reviewed route, configuration and provider-contract manifests.

Required controls cover:

- fail-closed single-user authentication and owner allowlisting;
- protected private routes and forced owner row-level security;
- revoked public database access and private object storage;
- client-secret and crypto-signing-secret exclusion;
- redacted logging and repository privacy;
- disabled public indexing; and
- dependency and configuration review.

Every control records a fixed command identifier, exact UTC execution bounds,
redacted-summary digest and complete assertion counts. Provider-backed controls
require connected evidence; a repository contract alone cannot satisfy them.

Missing controls remain review-required. Stale heads, command substitution,
manifest drift, failed assertions, incomplete isolation, public access, secret
exposure, private data or non-synthetic fixtures block the projection.

The contract retains no private artifacts and cannot dispatch Actions, merge,
connect providers, activate paid services, expose routes, collect secrets or
mutate Production.
