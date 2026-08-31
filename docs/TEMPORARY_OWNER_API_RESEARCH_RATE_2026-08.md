# Temporary Owner API Research Rate — August 2026

Status: **owner-approved temporary research authority**

Effective: **30 August 2026**

Expires: **1 September 2026 00:00 Australia/Brisbane (2026-08-31T14:00:00.000Z)**

## Owner instruction

The owner reports a current DNA Tier score of **12** and a current API allowance of **at least 150 requests/minute** for the remainder of August 2026. Tier scores reset to 0 at the start of each month.

For the remainder of August only, research/backfill workflows may use a **combined ceiling of 150 requests/minute** for read-only DNA data acquisition covering breeding, lineage, race history and other available API evidence.

## Safety boundary

- This is a temporary **research/backfill** override only.
- It does not change the website's default production request budget of 30 requests/minute.
- Workflows using this authority must fail closed after the expiry timestamp above.
- The 150 requests/minute ceiling is combined across the research workflow; do not multiply it by the number of configured API keys.
- Server `Retry-After`, reset and rate-limit metadata always override the local research target downward.
- No mutation, splice, payment, wallet or game transaction is authorised.
- The objective is to acquire as much authoritative read-only history as practical while the temporary allowance exists.

## Research priorities

1. Complete available finished-race metadata/doc/fill history.
2. Discover the broadest possible racing Core universe.
3. Acquire current Core info, racing stats, power, listing, assets, owner, stamina and splicing data for that universe.
4. Reverse lineage into parent -> offspring relationships.
5. Probe `splice_core` structure and any authoritative Splice request identifiers that may allow recovery of offspring `minted_at` timestamps.
6. Acquire complete available Bike/Car/Horse elapsed-time race histories for lineage-linked Cores from the historical result source, keeping modes strictly separated.
7. Build a chronological parent-offspring dataset suitable for breeder-lift research.
8. Preserve raw evidence and provenance in short-lived GitHub Actions artifacts until a permanent approved persistence path is commissioned.
