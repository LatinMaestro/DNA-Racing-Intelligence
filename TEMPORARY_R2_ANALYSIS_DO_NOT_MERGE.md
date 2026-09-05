# TEMPORARY R2 EVIDENCE ANALYSIS — DO NOT MERGE

> **TEMPORARY OPERATIONAL BRANCH ONLY.** This branch exists solely to perform a one-off, read-only analysis of already-retained private DNA Open Lab API evidence in Cloudflare R2.
>
> **DO NOT OPEN A PULL REQUEST FROM THIS BRANCH. DO NOT MERGE OR CHERRY-PICK THESE FILES INTO `main`.**

## Purpose

The repository owner has temporarily authorised this branch to:

- read the already-retained private P5 API evidence objects from the existing Preview R2 bucket;
- analyse race participation and available API race metadata across all observed Cores;
- analyse the owner's current Vault snapshot and current Core-state evidence;
- inspect the current Splice Arena catalogue;
- produce a temporary exploratory breeding-pair screen for owned-owned and owned-arena combinations; and
- produce sanitized derived analysis files for private review in ChatGPT.

The target Vault for the owner-specific part of the analysis is:

`0x5a29C2f20faf3f5160D27EfA5100aA10E9Bb934d`

## Hard boundaries

This branch must **not**:

- modify `main`;
- alter application product code or data models used by normal development;
- deploy Vercel or Cloudflare Workers;
- make any new DNA Open Lab API request;
- write, overwrite, delete or rename any R2 object;
- write to Neon or run a database migration;
- expose Cloudflare/R2/API/database credentials;
- upload raw API request/response envelopes as a GitHub artifact;
- initiate a race, team, splice, wallet or other DNA game action; or
- present exploratory breeding screens as validated breeding recommendations.

The temporary workflow uses only R2 `LIST` and `GET` operations. Its artifact contains sanitized derived summaries rather than raw evidence envelopes and is configured for one-day retention.

## Analytical limitations

The current DNA Open Lab race contract retained by the P5 acquisition exposes race metadata, participant IDs, mode, track/source values, gate context, star arrays and related fields where supplied. The connected API authority does **not** currently establish direct elapsed race time, finishing position or an authoritative explicit-distance field for the historical API race path. The raw `track` value must therefore remain an unclassified source value rather than being silently treated as distance.

Accordingly:

- all-Core race outputs from this branch are **diagnostic/coverage evidence**, not a replacement for validated time/speed performance analytics;
- raw Yellow/source-Gold and Blue star counts are diagnostics only and receive no positive quality weight without established pre-race opponent quality;
- current Core power/adjusted-odds/variance values are timestamped current context and must not be leaked backward into historical backtests; and
- breeding pair output is a **candidate screen requiring later lineage/pair validation and analytical review**, not a final breeding recommendation.

## Disposal

After the requested roster/breeding analysis has been completed and the temporary artifact is no longer needed, delete this branch. No part of this temporary operational workflow is intended to become permanent repository architecture.
