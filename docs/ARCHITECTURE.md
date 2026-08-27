# API-First Architecture Decision Record

Status: **Accepted current architecture authority**  
Effective: **27 August 2026**  
Scope: private single-owner application; Production remains explicit owner approval only.

## 1. Decision summary

DNA Racing Intelligence now uses DNA Open Lab v1 as the preferred source of game data.

Target topology:

```text
DNA Open Lab v1 API
        |
        v
server-only typed client + rate-aware sync/backfill planner
        |
        +--> private R2 raw/cache/evidence objects where useful
        |
        v
canonical API-neutral source adapters
        |
        v
compact owner-scoped Neon read models / aggregates / local strategy state
        |
        v
private authenticated Next.js website
```

The existing CSV pipeline remains an internal fallback, historical evidence source and equivalence harness. It is no longer the normal critical path.

## 2. Core application stack

- **Next.js App Router + strict TypeScript** for the private responsive web application.
- **Clerk** for authentication plus the existing server-side owner allowlist.
- **Neon PostgreSQL** for compact owner-scoped current state, checkpoints, application state, local strategy state, durable aggregates, reconciliation, economics and other relational state requiring transactions/RLS.
- **Private Cloudflare R2** for raw/full API evidence, immutable cache/evidence objects, retained CSV fallback evidence and other large replayable data where relational storage is unnecessary.
- **Cloudflare Worker/Queue and existing hosted job infrastructure** where background processing is required.
- **GitHub Actions** for repository validation and bounded operational workflows where already established.
- **Vercel** for the private website. Automatic Git deployment remains disabled. Deliberate protected Preview deployments are reserved for major commissioning milestones unless a development dependency genuinely requires one.

## 3. DNA Open Lab boundary

Base URL: `https://api.dnaracing.run/fbike/pub/v1`.

The API boundary must:

- use a Bearer API key only on the server;
- never expose the key to browser code, Git, CI logs, Issue comments or chat;
- treat the response body envelope `status: success|error` as authoritative, including documented error bodies returned with HTTP 305;
- surface rate-limit metadata and respect `Retry-After` on 429;
- assume correctness at the minimum supported tier of 30 requests/minute;
- use documented bulk bounds rather than relying on higher-tier throughput;
- tolerate optional additive response fields while failing closed on invalid required contract data; and
- preserve endpoint/version/retrieval provenance plus deterministic raw checksums at the canonical boundary.

Current documented request bounds:

| Operation | Maximum |
| --- | ---: |
| Vault bulk info | 100 |
| Core bulk families | 20 |
| Race docs/fills bulk | 20 |
| Finished races per time window | 200 |
| Vault search | 50 |

## 4. Browser and trust boundaries

The browser may call only this application's authenticated server routes/actions. It must not call DNA Open Lab directly.

The application server/worker is responsible for:

- API authentication;
- rate budgeting;
- payload validation;
- canonicalization;
- storage/checkpoint transactions;
- owner isolation;
- freshness publication; and
- secret-safe failure handling.

No game/wallet action boundary is introduced. The application remains advisory/read-only with respect to DNA Racing actions.

## 5. Canonical source adapters

Analytics and UI must not depend directly on provider transport names such as `hid`, `rvmode`, `cb` or other DNA-specific wire vocabulary.

Canonical adapters translate provider shapes into stable domain records while retaining:

- authoritative source/entity IDs;
- source timestamp where available;
- retrieval timestamp;
- endpoint family and API version;
- deterministic raw-payload checksum;
- canonical observation identity/natural key; and
- optional raw evidence reference where retained privately.

Unknown additive fields remain attributable through raw evidence without silently becoming analytical features.

## 6. Source authority

After connected P3 discovery, each fact is classified into one of four authority classes:

1. **API supersedes** — API becomes the normal current/historical authority.
2. **API supplements** — API adds current or richer facts to existing historical evidence.
3. **CSV-only fallback** — fact remains available only through retained export evidence until/unless API support exists.
4. **Local strategic state** — owner-managed state that game data must never overwrite.

Examples of local strategic state include notes, manual ME strategy, Pro League roster versions, substitution ledger, Discovery plans, lifecycle recommendations, manual accounting/reconciliation and owner-entered Tournament configuration.

## 7. Sync and backfill architecture

The scheduler is designed for 30 requests/minute and uses bulk endpoints first.

Historical race backfill uses an adaptive finished-race crawler:

1. request a bounded time window;
2. if the window returns fewer than 200 records, treat that window as non-saturated subject to normal contract checks;
3. if it returns exactly 200, recursively split the time window;
4. continue until every leaf window is demonstrably non-saturated; and
5. hydrate race documents in batches no larger than 20.

All source families use durable checkpoints/cursors, idempotent writes and retry/backoff rules. A partial run cannot replace the last-good published dataset.

## 8. Availability and API-tier loss

API access loss is a **sync pause**, not an application outage.

If TierBadge/API-key eligibility is lost or the API is temporarily unavailable:

- stop background sync safely;
- keep the last successfully published dataset active;
- continue serving analytics/read models normally;
- mark affected current-state data with clear freshness/staleness status; and
- resume from the last durable checkpoint/window when access returns.

Do not build a separate degraded-mode product and do not require immediate tier restoration for the website to remain usable.

## 9. Current versus historical data and no-leakage

Current API observations such as power, adjusted odds, variance, stamina, equipped assets, owner/listing state, current racing stats and current splice state must be timestamped observations.

They must not be joined backward into historical race backtests unless a historical observation existed before the event cutoff. Historical performance models continue to use information available strictly before the event being evaluated.

Current observations and historical facts therefore use separate time semantics and are displayed separately where necessary.

## 10. R2 and Neon placement

### Neon

Use Neon for compact relational state requiring strong transactional semantics, including:

- owner/account mapping and forced-RLS application state;
- sync checkpoints and last-good publication pointers;
- current canonical read models;
- durable compact analytical aggregates;
- local strategy state;
- Pro League roster/substitution history;
- Tournament/Maiden configuration and state;
- economic ledger/reconciliation; and
- recovery/operation metadata.

### R2

Use private R2 where large immutable/replayable evidence is more appropriate, including:

- raw/full API evidence where retained;
- API evidence manifests;
- private cache objects;
- retained CSV fallback/raw evidence;
- large analytical/replay artifacts; and
- bounded scratch/evidence objects already proven by the existing import architecture.

Public R2 access remains prohibited.

## 11. Last-good publication and recovery

A refresh/backfill becomes visible only after the required family/batch is complete and validated.

- incomplete refresh does not replace last-good state;
- checkpoint advancement is atomic with accepted progress;
- replay is idempotent;
- restart resumes from durable progress;
- provider/rate failure preserves the previous active dataset;
- recovery proof must cover partial failure, rate limiting, tier loss, reinstatement and catch-up.

## 12. Pro League architecture priority

The first owner-usable commissioning target is `/pro-league`.

Its domain includes:

- 12–25 Core roster versions;
- strongest nucleus plus optional incremental slots;
- alternates and structural gaps;
- every current rule validator;
- annual substitution ledger;
- evidence snapshots;
- Discovery queue;
- active-race opportunities;
- breeding queue using official pair info/validation when connected; and
- sync/freshness/stale-but-usable state.

API ownership may reconcile current game holdings but must never erase owner-maintained roster, notes, ME, substitution or lifecycle strategy.

## 13. Capacity and persistent-real-data gate

A live API key alone does not authorise persistent real backfill.

Before the first persistent real Preview sync, P5 must prove:

- PostgreSQL 18 physical storage and peak behavior including heap/index/TOAST/transient overlap;
- private R2 footprint/cost;
- restart/replay/idempotency;
- partial failure/rate limit/tier loss/reinstatement/catch-up; and
- explicit positive headroom below `536870912` bytes for the relevant Neon limit.

The owner must then explicitly approve the first persistent real Preview sync.

## 14. Security, licensing and deployment controls

- Production deployment/schema/data changes require explicit owner approval.
- No public route/domain is authorised.
- No paid-capacity change is authorised automatically.
- No commercial API use is authorised without explicit approval.
- API-backed UI must attribute DNA Racing.
- No wallet signing, betting, team creation, race entry, mint, trade or splice transaction is permitted.
- Real payloads and credentials remain out of Git.
- Vercel automatic Git deployment remains disabled.

## 15. Historical architecture evidence

Before 27 August 2026, the project was spreadsheet-first: periodic Race Merge/Core Details/Arena exports were uploaded into a guarded private pipeline, with private R2 evidence, Neon materialization/read models, queue processing, replay/rollback and extensive synthetic/connected proofs.

That work is **not discarded**. It remains valuable for:

- CSV fallback;
- API-vs-CSV equivalence;
- proven owner isolation/RLS;
- private R2 evidence handling;
- replay/recovery primitives;
- analytical read models; and
- migration/CI safety patterns.

The pre-API architecture is historical implementation evidence in Git history and specialised phase documents. Where it conflicts with this file, this API-first architecture is the current authority.
