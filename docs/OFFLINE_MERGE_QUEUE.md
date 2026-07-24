# Offline Merge Queue

Status captured: 2026-07-24  
Mode: no-Actions staging; no merge or pull-request mutation authorized

## Controls

- `main` remains `e1b10b90d7a54e8a116f4f0e7b89bd8f3abdf49a`.
- Pull requests 29 and 28 remain draft, mergeable and without reviews or
  review threads.
- Their failed checks stopped before runner allocation and do not constitute
  executed test evidence.
- No later branch may merge without complete exact-head GitHub Actions after
  runner capacity returns.
- Production remains disabled and fail-closed. No provider, paid
  infrastructure, domain or public route is part of this queue.

## Dependency order

| Order | Role                                  | Ref                                         | Exact head                                 | Required action                                                        |
| ----: | ------------------------------------- | ------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
|     1 | CI prerequisite                       | PR 29 / `agent/include-tsx-component-tests` | `0a3212bc6ac63721858a03048619ad678a85286e` | Run exact-head CI; review; merge first                                 |
|     2 | Vault registry prerequisite           | PR 28 / `agent/phase-2-vault-registry-v2`   | `8e8b51bcecb8adba9b4c34e2d90d57017113ce88` | Rebase after PR 29; run exact-head CI; review; merge                   |
|     3 | Source and game-rule correction       | `agent/real-source-contract`                | `cac5d0cbe0556851386d6322aa22a8238da0b2a2` | Rebase after prerequisites; prepare a focused source/BGC PR            |
|     4 | Integration evidence only             | `agent/offline-integration-rehearsal`       | `ca7572087f7275dd3945b3134f684cd7eb70fa8b` | Do not merge wholesale; use to verify Phase 2, 2A and 3-9 composition  |
|     5 | Import read/preview and owner session | `agent/import-workspace-read-preview`       | `29cc34cfe0d82ae6bbc7a62e81e569ccbc03bf80` | Recompose after phase merges; open as the first application-service PR |
|     6 | Guarded activation                    | `agent/import-activation-service`           | `73839d23e2a7896c1b64c9c745c3648f4fcfa6f5` | PR the four-commit delta after order 5                                 |
|     7 | Background processing                 | `agent/import-background-processing`        | `129d47fe6116e47c51ef275fb78ae70876be57bf` | PR the four-commit delta after order 6                                 |
|     8 | Private raw streaming                 | `agent/import-raw-object-streaming`         | `d004d1073aebf9702dad688b3b48e27e41e3cd0a` | PR the five-commit delta after order 7                                 |
|     9 | Aggregate refresh                     | `agent/import-aggregate-refresh`            | `758160fda011166e803462a9a75af28379c85fa7` | PR the five-commit delta after order 8                                 |
|    10 | Completion and rollback               | `agent/import-completion-rollback`          | `f0ddf35b3844c36d3558e0da75922b495227d76e` | PR the six-commit delta after order 9                                  |
|    11 | Vault read workspace                  | `agent/vault-read-workspace`                | `4aad2a8a4a14ad2300f20401da314e98ba086d25` | PR the eight-commit delta after order 10                               |
|    12 | Core Intelligence read workspace      | `agent/core-intelligence-read-workspace`    | `569074c49dc9b39479a44e4f8d441ee2d76b0283` | PR the eight-commit delta after order 11                               |
|    13 | Private chronological evidence        | `agent/private-chronological-validation`    | `3eaeb0373a07fb8dd65ed69b8aec7a6369411741` | PR the four-commit evidence delta after order 12                       |
|    14 | Vault Performance read workspace      | `agent/vault-performance-read-workspace`    | `892f30c17574216731ec5356dad10a75eb8f242e` | PR the seven-commit delta after order 13                               |

The integration rehearsal and application branches are staging evidence, not
permission to bypass the sequential merge order. Shared append-only documents
must be reconciled during every rebase.

## Latest hosted evidence

The exact Vault Performance descendant plus this documentation-only queue
passed:

- Prettier;
- ESLint;
- strict TypeScript;
- 106 test files and 882 tests;
- optimized Next.js build;
- dynamic owner-scoped `/imports`, `/vault`, `/core-intelligence` and
  `/vault-performance` routes;
- zero dependency vulnerabilities; and
- byte-for-byte verification of every file in its four-commit delta.

The branch has no workflow run or status context. Hosted validation is useful
staging evidence but is not a substitute for mandatory exact-head Actions.

## PR-ready delta summaries

### Import read and preview

Load only compact owner-scoped import status, preserve upload-preview-confirm
semantics, verify Clerk ownership server-side and keep persistence/provider
initialization lazy and fail-closed.

### Activation, processing and raw storage

Bind explicit confirmation to a persisted preview fingerprint, reserve
idempotent dispatch, process off request paths in bounded leases, stream private
objects with exact checksum/size verification and leave the active dataset
untouched after failure.

### Aggregate refresh, completion and rollback

Bind prepared aggregates to the exact active source-version fingerprint,
publish atomically, report completion deterministically and restore only prior
accepted versions while retaining provenance and scheduling a fresh refresh.

### Vault and Core Intelligence reads

Verify the owner before repository access, query only compact materialized
state, preserve durable IDs, exact mode/distance evidence, ME separation,
freshness and missing-data states, and keep recommendations disabled.

### Private chronological evidence

Record privacy-safe aggregate validation, enforce externally ordered
pre-event holdout, exclude partial outcomes, keep mode/distance/gate-count
baselines separate and prevent unsupported star, lineage, breeding or Maiden
claims from passing Gates C or E.

## Gate status and limitations

- Gate A: previously accepted.
- Gate B: repository contracts and offline evidence exist; first persistent
  private Preview import remains not accepted.
- Gate C: not accepted. The dry run is not the final recommendation model.
- Gate D: not accepted.
- Gate E: not accepted; breeding timestamps are unavailable.
- Gate F: client-only and not assessed.
- Reversible PostgreSQL execution on the latest cumulative head remains pending
  because this workspace has no PostgreSQL runtime.
- Routine-request p95 and connected provider capacity remain unmeasured.
- Point-in-time Maiden entitlement history is unavailable; the current ME
  snapshot cannot be projected backwards.
- Any concurrent application slice must receive its own exact remote head,
  full hosted validation and place in this queue before it is PR-ready.

## Merge procedure after Actions capacity returns

For each order above:

1. rebase onto the newly merged `main`;
2. review the complete diff and append-only decision reconciliation;
3. confirm no private source files, rows, identities, economic records or
   credentials entered Git;
4. run formatting, lint, strict types, all TS/TSX tests, build, migration
   apply/smoke/reversal where applicable and privacy scans;
5. require exact-head GitHub Actions success;
6. merge only that focused PR; and
7. advance the next dependency from the new `main`.

No queue entry authorizes Production activation.
