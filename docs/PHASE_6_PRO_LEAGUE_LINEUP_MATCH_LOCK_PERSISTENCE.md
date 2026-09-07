# Phase 6 Pro League lineup and match-lock persistence

Status: second P6 persistence slice implemented for review

## Boundary

This slice stores private owner strategy only. It never submits a map, roster or
match choice to DNA and does not connect a wallet, deploy a website or publish a
generation. The four observed maps remain Bike-only local configuration, not API
race-history facts.

## Reusable lineup versions

Each immutable lineup version binds to one immutable roster version and freezes
all 168 race lines from Anchor, Glory, Measure and Miracles. Domain validation
requires the exact published map ID, race number, race type, distance and gate
allocation for every line. A mapped Core must be rostered in the bound version.

Assignment provenance retains the source race and whether the owner assigned a
single line or expanded to matching race type plus exact distance. Expansion is
resolved only inside the selected map. All four maps must be complete before a
version can be saved. Exact retries are idempotent; a changed fingerprint under
the same identity fails closed.

## Match locks

An immutable match lock binds the exact lineup and roster versions to one
two-Vault match. It stores our side, scheduled and lock times, home pick, home
denial, away pick, resolved third map, the match-specific third-map policy and
its source. An explicit official/owner/trial fallback reference is retained only
when one was actually used.

The lock rejects non-participant Vaults, post-start locks, reused map choices,
third maps disallowed by the selected policy and a roster version different from
the lineup's roster. DNA submission remains a manual owner action.

## Isolation and recovery

Migration `0082` uses forced owner RLS and function-only runtime access for the
version, expanded line snapshot and match-lock tables. Writes are serializable;
reads are repeatable-read and read-only. The repository revalidates the exact
published catalogue and deterministic fingerprints after every read.

Validation covers the complete migration chain, 168-line lifecycle, replay and
conflict behavior, match-policy guards, cross-owner denial, reverse migration
and removal proof.

## Next slice

Apply migrations `0081` and `0082` to the protected private Preview only after
their reviewed merge, verify least-privilege reads/writes with synthetic owner
fixtures and clean all residue. Then connect API-backed current owner evidence
to explainable roster and map recommendations without auto-submission.
