# Phase 1 Import Server Action Adapter

## Purpose

This adapter exposes the validated import owner-action service through
Next.js Server Actions without enabling an upload form or any provider-backed
capability.

It is a request-transport boundary only. The underlying guarded intake and
completion services remain authoritative for validation, capacity, owner scope,
idempotency and private-object rules.

## Request authentication

Every action invocation resolves the current Clerk session inside the server
request. No owner ID is accepted from the browser.

The session ID must match `AUTHORIZED_CLERK_USER_ID` before the underlying
service can access persistence or another provider. Signed-out requests remain
disconnected and a non-owner fails closed.

## Fail-closed capability state

The adapter deliberately supplies the explicit unavailable intake and completion
capabilities.

Consequently, even a verified owner receives `not_configured` and the adapter
cannot:

- create a private-object upload target;
- reserve or update an upload batch;
- inspect an uploaded object;
- schedule preview processing;
- activate a source version;
- advance freshness or aggregate completion; or
- change recommendations.

A later focused provider-adapter slice must replace these capabilities only
after approved Preview configuration exists. Provider SDK initialization must
remain lazy, server-only and absent from module scope.

## Browser boundary

The Server Actions accept only:

- validated upload candidate metadata and an idempotency key for intake; or
- a durable upload-batch ID and idempotency key for completion.

They do not accept an owner ID, file content, a preview body, source-version
state, freshness values or recommendation evidence.

## Synthetic verification

Tests verify signed-out behaviour, non-owner rejection, per-invocation session
resolution and explicit provider-not-configured results for both intake and
completion.

The tests use synthetic metadata only. They do not connect Clerk, storage,
persistence or a queue and cannot establish Gate B or enable Preview imports.
