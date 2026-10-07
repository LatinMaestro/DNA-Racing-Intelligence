# DNA Open Lab v1 API reference authority

Status: **mandatory repository authority**  
Upstream reference: https://api.dnaracing.run/fbike/pub/v1/llm.txt  
Base URL: https://api.dnaracing.run/fbike/pub/v1

## Why this exists

The DNA Open Lab API reference is a first-class implementation authority. Future work must not rely on chat memory, old screenshots or previously observed permissive behaviour when the published API contract is more restrictive.

The machine-readable mirror used by code and tests is `lib/dna-open-lab-api-reference.ts`. The public reference is re-probed by the connected discovery workflow without logging credentials or private payloads.

When the upstream reference changes:

1. inspect the live reference and connected shapes;
2. update the machine-readable mirror and affected client types;
3. run static contract tests;
4. run the read-only connected discovery/reference probe;
5. only then change acquisition behaviour.

## Rate limits and keys

The documented TierBadge ladder is:

| Minimum `tot_score` |                Rate |
| ------------------: | ------------------: |
|                 2.5 | 150 requests/minute |
|                   2 |  80 requests/minute |
|                   1 |  30 requests/minute |

A vault may have at most three active keys. Rate headers are `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Class`, with `Retry-After` on 429.

Do not assume that three keys mean 3x the documented vault throughput. Independent counters must be proven by connected evidence for the exact endpoint before parallel lanes are enabled.

## Documented request bounds

- `/vault/info_bulk`: 100 vaults
- `/vault/search`: query at least 2 characters, result limit at most 50
- `/races/finished`: at most 200 finished races per time window
- `/races/docs`: at most 20 Race IDs
- `/races/fills`: at most 20 Race IDs
- every Core bulk endpoint: at most 20 Core IDs

A live endpoint accepting a larger payload does **not** authorize the application to exceed these published limits.

## Endpoint families

The repository must maintain and test the full read-only surface:

- Utility: `/test`, `/test_auth`
- Vault: info, info_bulk, search, cores, cores_full, tier_badge, recent_races
- Races: active, finished, docs, fills
- Cores: info, racing_stats, power, listing_price, attached_assets, owner, stamina, splicing_info, each documented bulk counterpart
- Current live Cores additions confirmed by the owner's 7 October 2026 API Reference recording: `telemetry`, `telemetry_bulk`, `telemetry_benchmark`
- Tokens: prices
- Splice: doc GET/POST, arena, pair_info, pair_validate
- Market: advertised as coming soon and therefore not a callable dependency

The same recording shows the Cores panel as **19 LIVE**, which is why telemetry is no longer treated as an undocumented curiosity.

## Telemetry

Current API Reference evidence describes per-Core telemetry as per-distance race aggregates with best/median/slowest time, top/floor speed and spread, bucketed by `cb` with paid-race variants. `telemetry_benchmark` compares one Core/distance against a cohort and returns aggregate benchmark statistics when a qualifying cohort exists.

Telemetry is analytical aggregate evidence. It does **not** replace immutable Race/Core outcome facts needed for complete historical reconstruction.

## Historical backfill and live updates

Use the public race API race-centrically:

1. discover finished races with `/races/finished`;
2. recursively split any 200-result saturated time window until completeness is demonstrable;
3. hydrate Race documents in batches of at most 20 through `/races/docs`;
4. resolve entrants once from canonical Race authority;
5. fetch only outcome facts still missing for the exact Race/Core memberships.

The separate legacy `/fbike/i/hraces` family remains the observed source of per-Core `pos`, elapsed `time` and `cb` where those values are not exposed by the public Race document. It is not part of Open Lab v1 `llm.txt`; it must therefore be used narrowly, checkpointed and never treated as the primary race-discovery mechanism.

For ongoing updates after history is complete, advance durable finished-race time cursors rather than repeatedly scanning lifetime Core histories.

## Best-practice rules

- Cache immutable race results forever and cache slower-changing reference data locally.
- Prefer bulk endpoints.
- Poll no faster than the underlying data changes.
- Read rate headers and obey 429/`Retry-After`.
- Keep keys server-side only.
- Check the response body's `status`; do not assume HTTP status alone is authoritative.
- Preserve DNA Racing attribution in UI surfaces using its data.
