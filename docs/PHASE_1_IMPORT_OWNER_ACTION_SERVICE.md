# Phase 1 Import Owner Action Service

## Purpose

This service is the server-only action boundary between an authenticated owner
request and the existing guarded private-upload intake and upload-completion
services.

It does not enable an upload form, object-storage provider, persistence adapter,
queue, Preview import or Production import.

## Identity boundary

Each action resolves the current Clerk owner session inside the server request.
The browser cannot supply or override an owner ID.

The resolved session ID must match the server-side configured owner allowlist
before either upload persistence or private-object inspection can occur.
Signed-out requests remain disconnected and a signed-in non-owner fails closed
before provider access.

## Supported actions

The service currently exposes two provider-neutral operations:

1. begin a guarded direct-upload reservation using validated file metadata,
   approved-capacity evidence and the existing upload-intake contract; and
2. verify completion of one reserved upload batch and schedule its deterministic
   pre-confirmation preview using the existing upload-completion contract.

Both operations preserve the underlying idempotency keys and durable batch IDs.
The service never accepts file bytes, a preview body, active source versions,
freshness values or recommendation data from the browser.

## Fail-closed configuration

Provider capabilities remain explicit dependencies. When the private
repository, object store, capacity gate or preview queue is not configured, the
action returns `not_configured` and performs no mutation.

Provider SDKs are not initialized by this service. A later adapter slice must
construct capabilities lazily inside the server runtime after owner
authentication. Module import and `next build` must remain network-free.

## Privacy and non-goals

- No raw file content, filename, upload target or private metadata is logged.
- No source version is activated at upload intake or completion.
- No freshness, aggregate or recommendation state changes at this boundary.
- No browser-supplied owner ID is accepted.
- No wallet, game, race-entry or Production action is possible.
- Owner confirmation, post-confirmation processing, completion reporting and
  rollback remain separate services.

## Synthetic verification

Tests cover:

- in-action session resolution;
- signed-out fail-closed behaviour;
- non-owner rejection before upload persistence;
- explicit provider-not-configured behaviour;
- exact owner scoping for upload reservation; and
- fresh owner verification before upload completion and preview scheduling.

The tests use synthetic metadata only. They do not establish Gate B, connect a
provider or authorize a private hosted import.
