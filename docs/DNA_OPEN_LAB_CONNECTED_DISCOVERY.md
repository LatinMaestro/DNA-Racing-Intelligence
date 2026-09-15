# DNA Open Lab Connected Discovery Evidence

## Scope and provenance

This record contains only redacted structural evidence from the read-only DNA Open Lab connected workflow. It contains no API key, Vault address, Core ID, race ID, payload value or raw response.

- first successful contract run: [`33078637484`](https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33078637484) at `4e2f958f6a406183b36f1e69294ed18733a10d0e`
- independent-counter proof run: [`33079595784`](https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33079595784) at `d381ed2e8bb8f7b85aa24a11a79638c8f00cdc5d`
- bounded follow-up run: [`33088733045`](https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/33088733045) at `a2352494e307af955d0a4b59a3f873880f9fed00`
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

## Bounded history and semantic-error follow-up

The follow-up run made 66 read-only probes under the same 30 requests/minute combined gate: 42 succeeded, 22 returned valid API-error envelopes, two optional Splice document calls remained unprobed and none was rate limited.

Five finished-race windows were accepted and returned records whose `start_time` values fell inside the requested bands:

| Window age    | Request bound | Redacted result class | Timestamp check |
| ------------- | ------------- | --------------------- | --------------- |
| 0–7 days      | 200           | at request limit      | verified        |
| 30–90 days    | 1             | at request limit      | verified        |
| 90–365 days   | 1             | at request limit      | verified        |
| 365–730 days  | 1             | at request limit      | verified        |
| 730–1095 days | 1             | at request limit      | verified        |

This proves bounded finished-race availability at least into the two-to-three-year band. It does not prove complete counts for any band: the recent request saturated at 200, and the older probes deliberately requested only one record. The adaptive split/deduplication crawler remains required for complete backfill.

Ten distinct bounded telemetry-benchmark candidates and twelve diversified Splice-pair candidates each returned a valid HTTP-200 API-error envelope. Single and bulk telemetry endpoints still succeeded. The benchmark and pair-validation observations are therefore semantic/provider rejections rather than malformed transport contracts. Telemetry benchmark is classified as optional/unavailable for the observed sample and must not block normal Core sync. A successful currently valid `pair_validate` example remains open before official pair viability can be promoted.

## Per-Core result-history follow-up

A later read-only investigation corrected the original race-document-only
assessment. The separate per-Core result-history family exposes `cb` (distance
code), `time` (elapsed seconds), `pos` (finishing position), `rid` (race ID) and
`hid` (Core ID). The owner-wide first-page scan covered all 214 then-current
owned Cores and found those three performance fields together in 10,374 of
10,383 rows. A bounded join then matched 225 of 225 sampled result rows to v1
race documents by race and entrant Core identity, with 225 of 225 comparable
distance codes agreeing.

The dispatch-only pagination proof
[`34934040226`](https://github.com/LatinMaestro/DNA-Racing-Intelligence/actions/runs/34934040226)
made no persistent write and logged no private identity or payload. It found a
50-row full page and a non-empty short page while scanning 186 of the 214
owned Cores. Both the full page and a later empty page replayed identically;
the page after that empty page also remained empty. Therefore 50 is the
observed page cap, a short page is not terminal by itself, and acquisition must
request and retain the first explicit empty page before closing a Core cursor.
This is behavioral evidence for the observed contract, not permission to
publish a partial generation.

## Endpoint-family observations

| Family         | Successful observations                                                                                                           | Other observations                                                                                   | Root contracts established                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Authentication | six paired calls                                                                                                                  | none                                                                                                 | object with scopes and nested rate metadata             |
| Vault          | info, bulk info, search, Core IDs/full Cores, tier badge, recent races                                                            | none                                                                                                 | objects, keyed bulk object and arrays                   |
| Core           | info, racing stats, power, listing, assets, owner, stamina, splicing and per-Core result history; all documented v1 bulk families | ten telemetry-benchmark candidates returned semantic API-error envelopes                             | single objects, bulk arrays and paginated result arrays |
| Telemetry      | single and bulk                                                                                                                   | benchmark returned an API-error envelope                                                             | object and array with mode/career statistic groups      |
| Races          | active, finished, documents and fills                                                                                             | none                                                                                                 | arrays; race IDs observed as strings in this sample     |
| Tokens         | current prices                                                                                                                    | none                                                                                                 | object of numeric current/reference prices              |
| Splice         | Arena and pair info                                                                                                               | twelve pair validations returned semantic API-error envelopes; optional document GET/POST not probed | paginated Arena object and nested pair-info object      |

The two API-error observations were valid, redacted API envelopes over HTTP 200. They do not prove endpoint unavailability: telemetry benchmark can be sample/data dependent, while pair validation can reject the selected pair. The optional Splice document calls require a real read-only request ID and were intentionally skipped because none was configured.

## Contract decisions supported by the run

- Splice Arena returns `{ cores, has_more, limit, page }`. Each observed Core exposes numeric `hid`, `fno` and `price_usd` plus string identity/type/gender/element/color fields.
- Core bulk endpoints return arrays matching their single-record families. Vault bulk info is instead an object keyed by a dynamic identifier; redacted evidence collapses that key to `*`.
- Current Core state includes separately nested power, adjusted odds, variance, stamina, attached assets, listing, racing-stat and splicing observations. These are not historical backtest facts.
- Observed nullability includes recent/active race start times, tournament profits in some bulk Core statistics, stamina refill time, lineage fields, off-chain Splice state and pair pricing.
- Core identifiers were numeric. Race identifiers were strings in the observed sample; the transport boundary continues to accept the existing string-or-number race identifier type until broader evidence justifies narrowing it.
- Timestamp fields were ISO-like strings or null in game records; authentication metadata used a numeric timestamp. Exact semantic/timezone authority remains a mapping concern rather than something inferred from field names alone.
- Active-race `class` was numeric in the sample, `start_time` was null and `end_time` was omitted. Canonical current-race mapping therefore preserves the class source type, accepts a null start and treats an omitted end as unknown/null rather than enforcing the earlier synthetic-only shape.
- Race documents expose rich entry, economics, payout, tag and scheduling structure. Those race-document shapes do not directly expose elapsed time or finishing position, but the separately observed per-Core result family supplies linked `cb`, `time` and `pos` evidence. `track` remains an unclassified source value; it is not silently interpreted as distance.

## Source-authority matrix

| Canonical fact family                 | Critical-path class   | Reason                                                                                    | Critical-path disposition                                                     |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Current ownership                     | API authority         | Vault/Core ownership shapes succeeded                                                     | persist from API; preserve local strategy separately                          |
| Historical race metadata              | API authority         | active/finished/document/fill shapes and two-to-three-year bounded availability succeeded | persist proven fields only                                                    |
| Historical race outcomes/performance  | API authority         | per-Core result history exposes joined distance/time/position evidence                    | persist privately; keep recommendations held until complete daily publication |
| Core identity and lineage             | API authority         | identity and splicing shapes succeeded                                                    | persist proven identity/splicing fields                                       |
| Current Arena and Splice              | API authority         | paginated Arena and pair info succeeded                                                   | persist current Arena/pair info; valid-pair success remains a P9 dependency   |
| Current Core operational state        | API authority         | power/stamina/assets/listing/stats shapes succeeded                                       | keep timestamped and establish predictive use separately                      |
| Current token prices                  | API authority         | numeric current price object succeeded                                                    | current/reference display only; no historical substitution                    |
| Historical dated valuation            | API unavailable       | no historical price endpoint was observed                                                 | disclose limitation unless an authoritative historical source appears         |
| Pro League roster, notes and strategy | local strategic state | owner-maintained decisions are not game facts                                             | never overwritten by API reconciliation                                       |

Connected shapes are sufficient to treat the successful families above as API authority for API-only persistence. This does not manufacture historical valuation or any other fact not present in those source contracts.

## Critical-path disposition

At the owner's direction, CSV comparison is benched and no longer blocks P3, P4, P10 or private website commissioning. The API-only critical path proceeds with these explicit limitations and deferred items:

1. Per-Core result history restores elapsed time, finishing position and distance evidence, but remains unavailable to recommendations until its durable collection and complete-generation publication are commissioned.
2. Fresh official `pair_validate` evidence remains mandatory before any final pair advice; a held pair does not block result-history persistence.
3. Optional Splice document GET/POST remains deferred unless a safe existing request ID is later supplied through a repository secret.
4. API-vs-CSV equivalence remains optional post-critical-path work.

The existing equivalence harness remains preserved with its count-only redaction boundary. No representative CSV rows are required for current delivery.

The later P5 authority separately permitted and completed the immutable first
historical backfill. This discovery evidence did not authorize that write and
does not authorize persistent per-Core result collection, Preview deployment or
Production change.
