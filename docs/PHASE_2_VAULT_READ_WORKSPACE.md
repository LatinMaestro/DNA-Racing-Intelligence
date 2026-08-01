# Phase 2 Vault Read Workspace

## Scope

This slice replaces the Vault placeholder with an authenticated, owner-scoped
Server Component and a provider-neutral application read service.

It does not configure private persistence, upload a Vault snapshot, enable
manual edits, issue a Maiden recommendation or change Preview or Production.

## Application boundary

The service:

- verifies the authenticated Clerk owner against the server-side allowlist
  before persistence can be queried;
- returns explicit identity-not-connected and persistence-not-configured states;
- loads only owner-scoped snapshot, ownership-edit, Maiden-override and known
  durable-ID evidence;
- validates and canonicalizes every repository object, array, identifier and
  discriminant before domain projection;
- delegates chronology, duplicate, identity, Maiden and warning behavior to the
  existing deterministic Vault registry; and
- treats malformed persistence evidence as an error rather than an empty Vault.

The repository-safe adapter remains unavailable. No provider SDK or database
client is initialized at module scope or during `next build`.

## Interface

The private Vault page shows:

- the identity/persistence connection boundary;
- active owned-core, Maiden-eligible, unresolved-identity and missing-profile
  counts;
- semantic UTC `Data current through` and `Last imported` timestamps plus
  freshness;
- confirmed durable core IDs and ownership/ME provenance when connected; and
- an explicit historical-snapshot and no-live-availability disclosure.

Missing ownership or Core Details remains unavailable evidence. It is never
shown as a zero-value Vault or negative assessment.

All edit controls remain disabled until authenticated owner-only persistence,
optimistic concurrency and audit records are implemented.

## Validation

Synthetic tests cover:

- identity and persistence fail-closed states;
- non-owner denial before persistence;
- malformed runtime repository evidence and invalid request time;
- canonical owner-scoped deterministic registry projection;
- accessible semantic headings, lists, timestamps and disabled controls;
- separate Maiden and profile states; and
- historical freshness and non-live wording.

Provider persistence, private snapshot execution, mutations and Production
remain gated.
