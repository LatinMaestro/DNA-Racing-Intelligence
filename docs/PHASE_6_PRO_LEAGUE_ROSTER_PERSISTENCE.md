# Phase 6 Pro League roster persistence

Status: first P6 persistence slice merged; migration `0082` builds on it

## Boundary

This slice persists private owner strategy state after P5 without publishing or
submitting anything to DNA. It does not create a team, register a roster, map a
Core, enter a race, connect a wallet or deploy Production.

The persisted state is API-first and Bike-only for Pro League use. It references
accepted evidence generations by timestamp and SHA-256; it never stores raw API
responses. Current My Vault reconciliation may invalidate a future recommendation,
but it must not erase an older roster version, member reason or substitution fact.

## Roster versions

Every immutable roster version records:

- the current owner-confirmed ruleset and ageing-aware owner strategy IDs;
- a monotonically numbered owner-local version identity;
- the explicit initial-roster substitution-counting state (`unresolved`, counts,
  or does not count);
- an evidence cutoff, rationale and deterministic version fingerprint;
- 12–25 rule-valid rostered Cores; and
- separately ordered alternates.

Each Core snapshot freezes its name, element, class, sex and F-number together
with its roster role, reason, evidence generation, evidence timestamp, confidence
and evidence fingerprint. The database independently enforces roster size,
female rounding, element and Genesis caps, the F5/F10 ceilings, two Cores above
F15, naming, ownership assertion and point-in-time cutoff.

Roles are `nucleus`, `optional`, `structural_coverage`, `marginal` and
`alternate`. An alternate is not silently counted as rostered.

## Annual substitution ledger

The append-only ledger permits at most ten numbered substitutions per owner and
season. Entries must be contiguous, connect consecutive roster versions and
match exactly one outgoing and one incoming rostered Core. Each entry retains a
reason and point-in-time evidence identity. Exact retries are idempotent;
conflicting reuse fails closed.

Initial roster creation is not written as a substitution while the governing
counting rule remains unresolved. The chosen interpretation stays visible on
every roster version.

## Isolation and recovery

Migration `0081` provides forced RLS on all three tables. The application runtime
has no direct table access and may use only four owner-checked security-definer
functions. The repository verifies the authenticated owner, forced RLS,
least-privilege runtime role and function grants inside every transaction.

Roster and substitution writes use serializable transactions. Reads use
repeatable-read, read-only transactions. Migration validation covers the complete
chain, lifecycle smoke test, reverse migration and removal proof.

## Next slice

Migration `0082` now implements versioned four-map lineups and immutable match
locks against these roster versions. After reviewed merge, apply both P6
migrations to the protected private Preview with synthetic, reversible evidence.
