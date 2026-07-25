# Phase 1 Import Recovery Action

## Scope

This slice adds the authenticated server-only transport for requesting a
reasoned rollback through the existing recoverable import service. It does not
connect a persistence repository or execute a rollback.

## Contract

- Resolve Clerk identity inside every rollback request and never accept an
  owner ID from the browser.
- Require the authenticated owner to match the server-side allowlist before
  persistence access.
- Accept only a durable active-batch ID, a 10–500 character reason, an
  idempotency key and explicit owner confirmation.
- Delegate to the owner-scoped transactional rollback repository.
- Restore only a prior accepted version and preserve the existing not-found,
  not-active and no-prior-version outcomes.
- Retain provenance and return the newly pending aggregate-refresh identity;
  never reuse the superseded aggregate completion state.
- Preserve exact idempotent replay from the repository contract.

## Disabled boundaries

The rollback repository remains explicitly unavailable in the Next.js Server
Action adapter. This slice cannot mutate an active source version, delete raw
objects or provenance, publish aggregates, retry a job or change Preview or
Production.

The browser cannot supply a source family, owner identity, restored version,
aggregate status, freshness value or recommendation state.

## Validation

Synthetic tests cover signed-out and non-owner rejection, unavailable
persistence, explicit acknowledgement, exact reasoned delegation and pending
aggregate-refresh reporting. No real batch, filename, source record, credential
or provider is used.
