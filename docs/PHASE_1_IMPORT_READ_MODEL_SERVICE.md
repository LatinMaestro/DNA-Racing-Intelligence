# Phase 1 Import Read-Model Service

## Purpose

The Imports route previously constructed a permanently empty workspace with a 1970 clock. The route now uses a provider-neutral application service that can load accepted import status from an owner-scoped repository without initializing Clerk, Neon, R2 or another SDK during the build.

## Access boundary

The service requires two independent server-side identities before it may query persistence:

- the authenticated session owner ID; and
- the single configured owner allowlist ID.

Missing identity evidence produces an explicit `identity_not_connected` state and does not call the repository. A mismatch fails closed with an access-denied error. Private batch identifiers never enter the connection status.

The current route intentionally supplies no authenticated identity because Clerk is not connected. It therefore remains empty and disabled without inventing an owner or reading private persistence.

## Repository boundary

`ImportBatchRepository` has two states:

- `not_configured`, which returns the explicit `persistence_not_configured` connection state after owner verification; and
- `ready`, which accepts only the verified owner ID and returns private import batches for domain validation and projection.

Malformed or internally inconsistent repository rows are not converted to an empty state. They fail closed through the existing import-workspace contract.

No database or provider client is initialized at module scope. A later Neon adapter must create its client lazily at request time and preserve the same owner-scoped interface.

## Rendering behavior

The Imports route is a dynamic Server Component so future owner-specific status is not statically generated or shared across users. It passes only the validated workspace projection and a finite connection status to the display component.

The UI distinguishes:

- owner identity not connected;
- private status persistence not configured; and
- owner-scoped historical status connected.

Even the connected read model does not claim that raw upload or background processing is implemented. Upload remains a separately gated workflow.

## Synthetic verification

Tests verify:

- missing identity performs no persistence query;
- a mismatched owner is denied;
- configured identity with no repository remains explicitly unavailable;
- a ready repository receives only the verified owner ID;
- persisted batch inconsistencies fail closed; and
- each connection state renders semantic disabled-action copy without private identifiers.

The service does not configure Preview providers, upload private files, mutate Production or replace the remaining PostgreSQL migration checks.
