# Phase 9 Pro League breeding ranking persistence

## Purpose

Migration `0085` and the server-only Neon adapter preserve the held Pro League
breeding research inputs as a compact, owner-isolated last-good generation.
This removes the need to recompute or pass private pair evidence through a page
request while keeping the website read path incapable of publication or game
action.

## Publication contract

- A generation is limited to 200 ranking inputs, 2,000 candidate pairs, 4 MiB
  total canonical JSON and 512 KiB per ranking.
- The publisher supplies deterministic canonical JSON and SHA-256 row
  envelopes. PostgreSQL parses each payload, verifies its ranking identity and
  candidate array, recomputes every row digest, exact count, byte count and the
  generation digest, then activates the generation in one transaction.
- Exact retries are idempotent. Conflicting retries, invalid digests, partial or
  over-bound generations, and evidence-cutoff regressions fail without moving
  the active pointer.
- Forced row-level security partitions all three tables by owner. The runtime
  role has no direct table privileges and can use only the owner-scoped publish
  and read functions.

## Read contract

The server adapter uses a repeatable-read, read-only transaction pinned to the
configured owner. It verifies RLS and runtime-role safety, row order, hashes,
counts, canonical bytes and the generation digest before returning evidence to
the existing breeding workspace. Missing active state returns an explicit empty
source; invalid state fails the optional section without hiding the last-good
Pro League roster and 168-race map.

The environment factory exposes only `loadRankingEvidenceByOwner` to website
callers. It deliberately omits publication.

## Accepted-analysis publication boundary

Publication is a separate server-only composition step. It accepts only a
source snapshot marked both accepted and complete, with a non-empty ranking and
candidate set, exact expected counts, canonical authority timestamps and a
SHA-256 digest over the complete accepted analysis. It rejects changed content,
duplicate ranking identity, count drift, cross-owner access, mismatched authority
bindings and any attempt to claim Pro League race-type breeding evidence that
the API does not provide. Only after every check passes may it call the compact
generation publisher.

The snapshot must bind every ranking to the same accepted performance import,
the applicable accepted Arena import and the active roster evidence cutoff.
Publication time cannot precede source acceptance. Exact retries remain safe
through the repository's deterministic generation contract. Empty or partial
analysis can never replace the active last-good generation.

## Authority and commissioning status

This store contains research inputs, not approved pair recommendations. It does
not establish race-type pair evidence, perform official pair validation, pass
Gate E, connect a wallet or execute a splice. Fresh `pair_validate`, `pair_info`
and applicable Arena evidence remain mandatory at owner decision time.

The migration is exercised synthetically through apply, smoke, reverse and
removal checks in CI. On 2026-09-08, migration `0085` was also applied to the
existing non-default private Neon `preview` branch. Its lifecycle and cleanup
completed with zero synthetic owners, generations, ranking rows or active rows
remaining. The connector role cannot impersonate `dna_app_runtime`, so hosted
verification checked the runtime grants and forced RLS directly while exact
runtime-role execution remained covered by CI.

The private Pro League and Breeding routes now construct only the read facade
from their server-side environments. Missing configuration or a missing active
generation still produces the held unavailable/empty state. No website request
can obtain the publisher, and these changes do not publish a generation, deploy
Preview, alter Production or authorize a breeding transaction.

The accepted-analysis composition is implemented and tested but is not wired to
either page. No accepted source snapshot currently exists in Preview, so no
generation has been published.
