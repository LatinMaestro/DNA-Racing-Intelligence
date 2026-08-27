# DNA Open Lab Connected Discovery Evidence

## Scope and provenance

This record contains only redacted structural evidence from the read-only DNA Open Lab connected workflow. It contains no API key, Vault address, Core ID, race ID, payload value or raw response.

- first successful contract run: [`33078637484`](https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33078637484) at `4e2f958f6a406183b36f1e69294ed18733a10d0e`
- independent-counter proof run: [`33079595784`](https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33079595784) at `d381ed2e8bb8f7b85aa24a11a79638c8f00cdc5d`
- observed on: 27 August 2026
- evidence format: endpoint/outcome, HTTP status, bounded rate metadata, root kind, path/type summary and SHA-256 shape fingerprint
- persistence: none; the run wrote no API data and uploaded no artifact

The workflow made 40 read-only requests in about 64 seconds. It recorded 38 successful probe observations, two API-error envelopes and two intentionally unprobed optional calls. The client-pool snapshot accounts for 31 requests; six authentication and three telemetry probes use direct clients under the same conservative global budget.

## Authentication and rate evidence

All three distinct configured keys authenticated successfully twice with the required scopes. Each lane reported:

| Lane  | Initial remaining | Repeat remaining | Advertised limit | Rate class | Rate limited |
| ----- | ----------------- | ---------------- | ---------------- | ---------- | ------------ |
| key-1 | 149               | 148              | 150 req/min      | `api_key`  | 0            |
| key-2 | 149               | 148              | 150 req/min      | `api_key`  | 0            |
| key-3 | 149               | 148              | 150 req/min      | `api_key`  | 0            |

The equal clean starting counters followed by one decrement on each individual lane prove that the observed quota buckets are per key. The confirming run recorded `independentRateBucketsProven: true` and `independentRateBucketsEnabled: false`. The owner has chosen a standing website policy of 30 requests/minute combined across all keys. Advertised higher limits remain observability metadata and cannot raise the default lane or aggregate gate automatically.

The observed Tier Badge payload exposed only `vault` and `tot_score`; it did not expose a tier-level or rate-entitlement field. The 150-per-key allowance therefore cannot be attributed specifically to being above TierBadge level 4 from this evidence alone.

## Endpoint-family observations

| Family         | Successful observations                                                                                  | Other observations                                                                    | Root contracts established                          |
| -------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Authentication | six paired calls                                                                                         | none                                                                                  | object with scopes and nested rate metadata         |
| Vault          | info, bulk info, search, Core IDs/full Cores, tier badge, recent races                                   | none                                                                                  | objects, keyed bulk object and arrays               |
| Core           | info, racing stats, power, listing, assets, owner, stamina and splicing; all corresponding bulk families | telemetry benchmark returned an API-error envelope                                    | single objects and bulk arrays                      |
| Telemetry      | single and bulk                                                                                          | benchmark returned an API-error envelope                                              | object and array with mode/career statistic groups  |
| Races          | active, finished, documents and fills                                                                    | none                                                                                  | arrays; race IDs observed as strings in this sample |
| Tokens         | current prices                                                                                           | none                                                                                  | object of numeric current/reference prices          |
| Splice         | Arena and pair info                                                                                      | pair validation returned an API-error envelope; optional document GET/POST not probed | paginated Arena object and nested pair-info object  |

The two API-error observations were valid, redacted API envelopes over HTTP 200. They do not prove endpoint unavailability: telemetry benchmark can be sample/data dependent, while pair validation can reject the selected pair. The optional Splice document calls require a real read-only request ID and were intentionally skipped because none was configured.

## Contract decisions supported by the run

- Splice Arena returns `{ cores, has_more, limit, page }`. Each observed Core exposes numeric `hid`, `fno` and `price_usd` plus string identity/type/gender/element/color fields.
- Core bulk endpoints return arrays matching their single-record families. Vault bulk info is instead an object keyed by a dynamic identifier; redacted evidence collapses that key to `*`.
- Current Core state includes separately nested power, adjusted odds, variance, stamina, attached assets, listing, racing-stat and splicing observations. These are not historical backtest facts.
- Observed nullability includes recent/active race start times, tournament profits in some bulk Core statistics, stamina refill time, lineage fields, off-chain Splice state and pair pricing.
- Core identifiers were numeric. Race identifiers were strings in the observed sample; the transport boundary continues to accept the existing string-or-number race identifier type until broader evidence justifies narrowing it.
- Timestamp fields were ISO-like strings or null in game records; authentication metadata used a numeric timestamp. Exact semantic/timezone authority remains a mapping concern rather than something inferred from field names alone.
- Active-race `class` was numeric in the sample, `start_time` was null and `end_time` was omitted. Canonical current-race mapping therefore preserves the class source type, accepts a null start and treats an omitted end as unknown/null rather than enforcing the earlier synthetic-only shape.
- Race documents expose rich entry, economics, payout, tag and scheduling structure. The observed finished/document shapes did not expose a direct elapsed-time field, finishing-position field or explicit distance field. `track` remains an unclassified source value; it is not silently interpreted as distance.

## Source-authority matrix

| Canonical fact family                 | Current class         | Reason                                              | Required before promotion                                                      |
| ------------------------------------- | --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Current ownership                     | API supplements       | Vault/Core ownership shapes succeeded               | compare representative API ownership to retained current/reference evidence    |
| Historical race metadata              | API supplements       | active/finished/document/fill shapes succeeded      | compare IDs, entrants, mode, gates, stars and economics; prove history depth   |
| Historical race outcomes/performance  | CSV-only fallback     | no direct elapsed/position/distance fields observed | retain Race Merge unless another authoritative API result contract is proven   |
| Core identity and lineage             | API supplements       | identity and splicing shapes succeeded              | compare durable identity and representative non-null lineage to Core Details   |
| Current Arena and Splice              | API supplements       | paginated Arena and pair info succeeded             | compare current Arena membership and obtain a successful valid-pair validation |
| Current Core operational state        | API supplements       | power/stamina/assets/listing/stats shapes succeeded | keep timestamped and establish predictive use separately                       |
| Current token prices                  | API supplements       | numeric current price object succeeded              | current/reference display only; no historical substitution                     |
| Historical dated valuation            | CSV-only fallback     | no historical price endpoint was observed           | retain dated evidence unless an authoritative historical source appears        |
| Pro League roster, notes and strategy | local strategic state | owner-maintained decisions are not game facts       | never overwritten by API reconciliation                                        |

No family is yet classified as `API supersedes`.

## Remaining P3 evidence

P3 is not complete until the following are resolved privately without committing source values:

1. Run representative API-vs-known-CSV equivalence for race, Core, ownership and economics values.
2. Prove bounded historical depth/window behavior and determine whether another authoritative endpoint supplies elapsed time, position and distance; the observed finished/document contract did not.
3. Exercise `pair_validate` with a currently valid pair and distinguish semantic rejection from contract failure.
4. Exercise telemetry benchmark with a compatible sample, or formally classify its data-dependent error behavior.
5. Optionally inspect Splice document GET/POST only if the owner supplies a safe existing request ID through the repository secret.

The equivalence harness now has a count-only redaction boundary for connected evidence. It rejects duplicate entity reports and inconsistent field contracts, and it cannot emit entity keys, paths, filenames, checksums or source values. This is safety infrastructure only; it does not count as value-equivalence evidence until representative private CSV rows are supplied to the ephemeral comparison boundary.

Persistent real API backfill remains outside K1/P3 authority and still requires the separate P5 owner gate.
