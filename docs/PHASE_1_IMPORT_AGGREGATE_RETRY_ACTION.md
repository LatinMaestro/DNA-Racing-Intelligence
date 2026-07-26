# Phase 1 Import Aggregate Retry Action

## Scope

This slice adds an authenticated server-only boundary for retrying one failed
aggregate refresh without re-uploading its accepted private source files. It
reserves and queues work only; aggregate computation remains outside the web
request.

## Contract

- Resolve Clerk identity inside every retry request and never accept an owner ID
  from the browser.
- Require the server-side owner allowlist, a durable failed-refresh ID, a
  meaningful reason, an idempotency key and explicit owner acknowledgement.
- Allow persistence to reject missing, pending, running, completed or
  superseded work without queue delivery.
- Reserve one new retry refresh and dispatch against the same accepted
  owner-scoped source-version set.
- Return an exact queued replay without duplicate queue delivery.
- Record only a sanitized `queue_unavailable` failure if dispatch cannot be
  enqueued.
- Keep computation and atomic publication in the bounded aggregate worker,
  including its source-version fingerprint and supersession checks.

## Disabled boundaries

The repository and background queue remain explicitly unavailable in the
Next.js Server Action adapter. This slice cannot read a private source file,
compute or publish aggregates, change freshness, expose recommendations, import
Preview data or change Production.

## Validation

Synthetic tests cover signed-out and non-owner rejection, unavailable
capabilities, explicit acknowledgement, reason validation, missing and
non-retryable refreshes, successful queueing, idempotent replay and sanitized
queue failure. No real source record, filename, owner data, provider or secret
is used.
