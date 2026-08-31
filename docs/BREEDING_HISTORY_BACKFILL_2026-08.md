# Breeding History Backfill — August 2026

Status: **connected validation in progress**

This work implements the data-acquisition phase required to turn the breeder-quality domain foundation into evidence-backed parent -> offspring analysis.

## Pipeline

1. **Universe inventory**
   - adaptive finished-race crawl from 2020 to the live cutoff;
   - race document and fill hydration;
   - current Bike, Car and Horse Splice Arenas;
   - owner Vault/current races;
   - current Core info, racing stats, power, listing, assets, owner, stamina, splicing and telemetry;
   - recursive parent/grandparent expansion;
   - `splice_core` request-ID probing and Splice-document lookup where a real request ID is exposed.

2. **Full result history**
   - four coordinated history shards;
   - 37 requests/minute per shard, 148/minute combined;
   - every reachable result page per discovered Core;
   - Bike, Car and Horse records retained separately;
   - raw result evidence retained in short-lived workflow artifacts.

3. **Chronological offspring analysis**
   - reverse direct lineage into parent -> child relations;
   - prefer authoritative `minted_at` as offspring creation time;
   - first-race time may be retained as an exploratory proxy only;
   - calculate exact-distance Core performance from elapsed speed distributions;
   - freeze parent performance baselines before the offspring cutoff;
   - compare observed offspring quality with the two-parent expected baseline;
   - convert lift to population-relative residual percentiles;
   - feed only authoritative-creation outcomes into elite-breeder TARGET benchmarks.

## Connected recovery note

The first aggressive inventory attempt ran for roughly 35 minutes before DNA returned a transient HTTP 502 with a 60-second Retry-After value. The research workflows now preload a bounded transient-5xx retry wrapper so an otherwise healthy long crawl can back off and resume instead of discarding the run. Inventory and history phases remain concurrency-separated so the combined research request ceiling is never intentionally exceeded.

## Important evidence boundary

`domain/breeding-offspring-evidence.ts` prevents a first-race proxy or unknown creation time from promoting a Core to an elite-breeder TARGET. Proxy outcomes remain useful for discovery and prioritising further research, but they cannot be presented as chronologically proven breeder lift.

## Rate authority

The connected August workflows use the owner-approved temporary ceiling documented in `TEMPORARY_OWNER_API_RESEARCH_RATE_2026-08.md`. The production website remains at its normal 30 requests/minute policy.

## Transaction boundary

All work is read-only. No splice, payment, wallet signature or game mutation is performed.
