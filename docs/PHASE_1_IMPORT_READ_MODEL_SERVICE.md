# Phase 1 Import Read-Model Service

## Purpose

The Imports route previously constructed a permanently empty workspace with a 1970 clock. The route now uses a provider-neutral application service that can load accepted import status from an owner-scoped repository without initializing Clerk, Neon, R2 or another provider client during the build.

## Access boundary

The service requires two independent server-side identities before it may query persistence:

- the authenticated session owner ID; and
- the single configured owner allowlist ID.

Missing identity evidence produces an explicit `identity_not_connected` state and does not call the repository. A mismatch fails closed with an access-denied error. Private batch identifiers never enter the connection status.

The route now obtains the signed-in user ID from Clerk's server-side `auth()` request context. It accepts that identity only when both Clerk keys are configured and then independently requires the same ID to match `AUTHORIZED_CLERK_USER_ID` before querying persistence. Missing Clerk configuration or a signed-out request remains empty and disabled without inventing an owner. Partial Clerk configuration and malformed session evidence fail closed.

`proxy.ts` preserves the earlier deployment gate before invoking Clerk. Disabled Preview and Production requests still return a non-indexable 404 even when Clerk is not configured. An otherwise allowed request also returns 404 until both Clerk keys exist, and Clerk middleware then establishes request authentication context. The root provider is rendered only when the browser-safe publishable key exists, so repository builds without secrets remain valid.

## Repository boundary

`ImportBatchRepository` has two states:

- `not_configured`, which returns the explicit `persistence_not_configured` connection state after owner verification; and
- `ready`, which accepts only the verified owner ID and returns private import batches for domain validation and projection.

Malformed or internally inconsistent repository rows are not converted to an empty state. They fail closed through the existing import-workspace contract.

The Neon adapter now implements this interface without provisioning a database:

- it returns `not_configured` unless `DATABASE_URL` and `DNA_DATABASE_OWNER_ID` both exist;
- it imports and creates the Neon HTTP query function only on the first authorised repository read, never during module evaluation or `next build`;
- it opens one bounded read-only repeatable-read transaction;
- it sets `app.owner_id` only for that transaction so the existing forced row-level-security policies apply;
- it verifies that the internal database owner maps to the same authenticated Clerk user before returning any batch;
- it reads the 200 most recent supported import batches plus every active source version, so an older active dataset cannot disappear behind later quarantined attempts;
- it aggregates count/code-only warnings, unresolved identity reviews and pending observation reconciliation without reading raw race history; and
- it rejects malformed types, unsafe `bigint` counts, unsupported source/status values and inconsistent domain evidence rather than coercing them.

The route constructs this environment-backed repository after resolving the request's Clerk identity. A missing or signed-out identity returns before the lazy Neon factory is called. A signed-in non-owner is denied before persistence, and an authorised owner reaches the lazy Neon repository only when its own configuration also exists.

## Rendering behavior

The Imports route is a dynamic Server Component so future owner-specific status is not statically generated or shared across users. It passes only the validated workspace projection and a finite connection status to the display component.

The UI distinguishes:

- owner identity not connected;
- private status persistence not configured; and
- owner-scoped historical status connected.

Even the connected read model does not claim that raw upload or background processing is implemented. Upload remains a separately gated workflow.

## Synthetic verification

Tests verify:

- missing Clerk configuration performs no provider call;
- partial Clerk configuration fails closed;
- signed-out, signed-in and malformed Clerk session states remain distinct;
- missing identity performs no persistence query;
- a mismatched owner is denied;
- configured identity with no repository remains explicitly unavailable;
- a ready repository receives only the verified owner ID;
- missing database configuration creates no Neon query function;
- malformed internal owner IDs fail before provider initialisation;
- the Neon executor is created lazily and reused only after owner verification;
- the database-side Clerk mapping must succeed;
- PostgreSQL `bigint`, timestamp, Boolean, warning and review values are validated before projection;
- persisted batch inconsistencies fail closed; and
- each connection state renders semantic disabled-action copy without private identifiers.

The service adds the Clerk and Neon provider packages plus server-only adapters but does not configure either provider, add secret values, upload private files, mutate Production or replace the remaining PostgreSQL migration checks.
