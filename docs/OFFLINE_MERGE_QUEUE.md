# Offline Merge Queue

Status captured: 2026-07-26  
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

| Order | Role                                  | Ref                                            | Exact head                                 | Required action                                                        |
| ----: | ------------------------------------- | ---------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
|     1 | CI prerequisite                       | PR 29 / `agent/include-tsx-component-tests`    | `0a3212bc6ac63721858a03048619ad678a85286e` | Run exact-head CI; review; merge first                                 |
|     2 | Vault registry prerequisite           | PR 28 / `agent/phase-2-vault-registry-v2`      | `8e8b51bcecb8adba9b4c34e2d90d57017113ce88` | Rebase after PR 29; run exact-head CI; review; merge                   |
|     3 | Source and game-rule correction       | `agent/real-source-contract`                   | `cac5d0cbe0556851386d6322aa22a8238da0b2a2` | Rebase after prerequisites; prepare a focused source/BGC PR            |
|     4 | Integration evidence only             | `agent/offline-integration-rehearsal`          | `ca7572087f7275dd3945b3134f684cd7eb70fa8b` | Do not merge wholesale; use to verify Phase 2, 2A and 3-9 composition  |
|     5 | Import read/preview and owner session | `agent/import-workspace-read-preview`          | `29cc34cfe0d82ae6bbc7a62e81e569ccbc03bf80` | Recompose after phase merges; open as the first application-service PR |
|     6 | Guarded activation                    | `agent/import-activation-service`              | `73839d23e2a7896c1b64c9c745c3648f4fcfa6f5` | PR the four-commit delta after order 5                                 |
|     7 | Background processing                 | `agent/import-background-processing`           | `129d47fe6116e47c51ef275fb78ae70876be57bf` | PR the four-commit delta after order 6                                 |
|     8 | Private raw streaming                 | `agent/import-raw-object-streaming`            | `d004d1073aebf9702dad688b3b48e27e41e3cd0a` | PR the five-commit delta after order 7                                 |
|     9 | Aggregate refresh                     | `agent/import-aggregate-refresh`               | `758160fda011166e803462a9a75af28379c85fa7` | PR the five-commit delta after order 8                                 |
|    10 | Completion and rollback               | `agent/import-completion-rollback`             | `f0ddf35b3844c36d3558e0da75922b495227d76e` | PR the six-commit delta after order 9                                  |
|    11 | Vault read workspace                  | `agent/vault-read-workspace`                   | `4aad2a8a4a14ad2300f20401da314e98ba086d25` | PR the eight-commit delta after order 10                               |
|    12 | Core Intelligence read workspace      | `agent/core-intelligence-read-workspace`       | `569074c49dc9b39479a44e4f8d441ee2d76b0283` | PR the eight-commit delta after order 11                               |
|    13 | Private chronological evidence        | `agent/private-chronological-validation`       | `3eaeb0373a07fb8dd65ed69b8aec7a6369411741` | PR the four-commit evidence delta after order 12                       |
|    14 | Vault Performance read workspace      | `agent/vault-performance-read-workspace`       | `892f30c17574216731ec5356dad10a75eb8f242e` | PR the seven-commit delta after order 13                               |
|    15 | Discovery read workspace              | `agent/discovery-read-workspace`               | `f28f37a97e4bc93f862959d0e1eded9c7b2e69c8` | PR the eight-commit application delta after order 14                   |
|    16 | Tournament read workspace             | `agent/tournament-read-workspace`              | `e5decdd4dc616ae06d20196bb847645724da14d8` | PR the seven-commit delta after order 15                               |
|    17 | Maiden read workspace                 | `agent/maiden-read-workspace`                  | `c9b0004f7086c8a4fb489690d3465a701312596b` | PR the seven-commit delta after order 16                               |
|    18 | Breeding read workspace               | `agent/breeding-read-workspace`                | `c77c30b0169e2835a61c67368901d57ecc7860a9` | PR the seven-commit delta after order 17                               |
|    19 | Lifecycle read workspace              | `agent/lifecycle-read-workspace`               | `8ce3661b6392dd8dc23f0be207d1c75be892c1ee` | PR the focused Lifecycle delta after order 18                          |
|    20 | Open Race read workspace              | `agent/open-race-read-workspace`               | `6254a9a2a409486c4825653a022971f825b7e62f` | PR the six-commit staged Open Race delta after order 19                |
|    21 | Phase 9 readiness workspace           | `agent/readiness-read-workspace`               | `9a9cd34023755ebb8480e4d56f8c36c628a00957` | PR the seven-commit readiness delta after order 20                     |
|    22 | Manual ledger write service           | `agent/manual-ledger-write-service`            | `b34ce31b25a0bb17e2dee3bed60c5979247b9105` | PR the four-commit exact-entry/reversal delta after order 21           |
|    23 | Tournament payout write service       | `agent/manual-tournament-payout-write-service` | `0a5b38f46ab9881f7367a48de94ed62a40659e1e` | PR the five-commit payout/reconciliation delta after order 22          |
|    24 | Lifecycle economic write service      | `agent/lifecycle-economic-write-service`       | `b04c9423ca2ceb85a110d464624aa37613f4ca56` | PR the four-commit sale/burn/BGC delta after order 23                  |
|    25 | Lifecycle replay hardening            | `agent/lifecycle-economic-write-hardening`     | `f2dc526861736ce5bfbd4beccc8877801dcc0220` | PR the five-commit canonical replay fix after order 24                 |
|    26 | Breeding economic write service       | `agent/breeding-economic-write-service`        | `5adb71fd47103c830178c93e47eaa006a8071520` | PR the five-commit breeding economics delta after order 25             |
|    27 | Guarded import upload intake          | `agent/import-upload-intake-service`            | `e2a66de3bfa5ab5e9f6ec84b4cebfdcb167f24b4` | PR the five-commit upload-intake delta after order 26                   |
|    28 | Upload completion and preview dispatch | `agent/import-upload-completion-service`        | `a4b603feb03a09ce0e6d2a4772aac0c530b35baa` | PR the five-commit completion/dispatch delta after order 27             |
|    29 | Bounded import preview processing      | `agent/import-preview-processing-service`      | `8b8ec9f3b1bc91c84975840fa2708371149af2f4` | PR the five-commit preview-worker delta after order 28                  |
|    30 | Authenticated import owner actions     | `agent/import-owner-action-service`             | `bf52a3f408551275fca2167fd9fea395988fc2b7` | PR the five-commit owner-action delta after order 29                    |
|    31 | Fail-closed import Server Actions      | `agent/import-server-action-adapter`             | `e4c077da3a1e5d81371002b9d0d38a369ed27d26` | PR the five-commit Server Action delta after order 30                   |
|    32 | Bounded direct upload client          | `agent/import-direct-upload-client`              | `01c6667a23e7077993de87c0be4f8851b22925b3` | PR the five-commit direct-upload delta after order 31                   |
|    33 | Bounded file preparation client       | `agent/import-file-preparation-client`           | `c7dea5ccd2a031e6c6d979b50ec0ca6b915bb234` | PR the five-commit checksum-preparation delta after order 32            |
|    34 | Authenticated import confirmation     | `agent/import-confirmation-action-service`        | `fd499d1b5fa6d93fd833e80ef9e397a87f04aa88` | PR the seven-commit confirmation-action delta after order 33            |
|    35 | Authenticated import recovery         | `agent/import-recovery-action-service`            | `7ecfc18d8d8307211da31f71e1885cc795c0e555` | PR the seven-commit recovery-action delta after order 34                |
|    36 | Authenticated aggregate refresh retry | `agent/import-aggregate-retry-action-service`     | `6453a5761807441a833f5d23ab9884d022a4f36e` | PR the seven-commit aggregate-retry delta after order 35                 |
|    37 | Import progress and completion UI    | `agent/import-progress-completion-ui`          | `69b06066f35287042fb83d781d744a918b32d973` | PR the eight-commit progress/completion UI delta after order 36          |
|    38 | Import provider adapter bundle       | `agent/import-provider-adapter-bundle`         | `ce0aafcc446d7cb808dbf4c5aafb1e25e628a80a` | PR the five-commit lazy owner-bound adapter delta after order 37         |
|    39 | Import persistence operation adapter | `agent/import-persistence-operation-adapter`   | `6317d2f39c767e82586e8e6d6e62f21d5fdeea17` | PR the five-commit forced-RLS/idempotency delta after order 38            |
|    40 | Browser incremental SHA-256          | `agent/import-incremental-sha256`              | `eb364fdf6a383318fffc4bf2e09e020fad51a4f9` | PR the five-commit bounded hashing delta after order 39                   |
|    41 | Neon import persistence driver     | `agent/import-neon-persistence-driver`          | `c5c778166c6cfd2992622e87b16b1002ec9b118c` | PR the ten-commit driver/migration delta after order 40                   |
|    42 | Cloudflare R2 object storage       | `agent/import-cloudflare-r2-object-storage`     | `704537fc78cfcd99ca0743e12823252d48d8a7c9` | PR the seven-commit private-object adapter delta after order 41            |
|    43 | Cloudflare import queue adapter    | `agent/import-cloudflare-queue-adapter`         | `d188879f248b5f45e12aeb5be2a840b1e4b97523` | PR the five-commit preview/background queue delta after order 42            |
|    44 | Import provider capacity adapter  | `agent/import-provider-capacity-adapter`        | `70e5a82f758044aec088a652d1d29d93b91eb615` | PR the five-commit fresh-capacity delta after order 43                       |
|    45 | Vault Performance economic actions | `agent/vault-performance-economic-actions`     | `d115bf9b4fe972817377bbfa131906eb4d1e7454` | PR the five-commit fail-closed economic-action delta after order 44          |

The integration rehearsal and application branches are staging evidence, not
permission to bypass the sequential merge order. Shared append-only documents
must be reconciled during every rebase.

## Latest hosted evidence

The exact Breeding descendant passed:

- Prettier;
- ESLint;
- strict TypeScript;
- 114 test files and 906 tests;
- optimized Next.js build;
- dynamic owner-scoped `/imports`, `/vault`, `/core-intelligence` and
  `/vault-performance`, `/discovery`, `/tournaments`, `/maiden` and
  `/breeding` routes;
- zero dependency vulnerabilities; and
- byte-for-byte verification of every file in its four-commit delta.

The exact Lifecycle descendant subsequently passed the cumulative hosted
validation boundary:

- Prettier and ESLint;
- strict TypeScript;
- 116 test files and 912 tests;
- optimized Next.js build;
- dynamic owner-scoped routes through Lifecycle; and
- zero dependency vulnerabilities.

The Open Race and readiness descendants each passed focused hosted formatting,
lint and strict-TypeScript checks. Their ten synthetic workspace tests pass,
every published implementation blob matches its validated hosted copy, and both
exact heads have zero workflow runs or status contexts. Their next cumulative
full-suite rehearsal remains pending.

The manual-ledger write descendant passes focused formatting, lint, strict
TypeScript and six synthetic write/reversal tests. Its three published evidence
blobs match the validated hosted files, and the exact head has no workflow run
or status context.

The manual tournament payout descendant passes focused formatting, lint, strict
TypeScript and eight synthetic payout/reconciliation tests; the complete
focused harness passes 24 tests. Its three implementation, test and contract
blobs match the validated hosted files, and the exact head has no workflow run
or status context.

The lifecycle economic write descendant passes focused formatting, lint, strict
TypeScript and nine synthetic sale, burn and BGC-credit tests; the combined
focused harness passes 33 tests. Its three implementation, test and contract
blobs match the validated hosted files, and the exact head has no workflow run
or status context.

The lifecycle replay hardening descendant passes focused formatting, lint,
strict TypeScript and ten synthetic lifecycle-write tests; the combined focused
harness passes 34 tests. It canonicalizes exact durable fingerprints and replays
an already stored burn credit before burn-scope reconciliation. Its three
implementation, test and contract blobs match the validated hosted files, and
the exact head has no workflow run, status context or pull request.

The breeding economic write descendant passes focused formatting, lint, strict
TypeScript and eight synthetic orchestration tests; the combined focused harness
passes 42 tests. It records only completed/refunded transaction evidence, derives
offspring duplicate checks from owner-scoped persistence and replays existing
exact assignments before duplicate lookup. Its three implementation, test and
contract blobs match the validated hosted files, and the exact head has no
workflow run or status context.

The guarded import upload-intake descendant passes focused formatting, lint,
strict TypeScript and 12 synthetic intake tests; the combined focused harness
passes 54 tests and the dependency audit reports zero vulnerabilities. It gates
capacity before durable reservation, permits grouped Race Merge candidates,
rejects competing replacement snapshots and records incomplete private-object
targets as failed without touching active data. Its three implementation, test
and contract blobs match the validated hosted files, and the exact head has no
workflow run, status context or pull request.

The upload-completion descendant passes formatting, lint, strict TypeScript and
12 synthetic completion tests; the complete available hosted harness passes 66
tests and the dependency audit reports zero vulnerabilities. It verifies
owner-scoped private-object metadata, keeps missing direct uploads pending,
preserves full-stream checksum verification and queues one idempotent
pre-confirmation preview without touching active data. Its three implementation,
test and contract blobs match the validated hosted files, and the exact head has
no workflow run, status context or pull request.

The bounded preview-processing descendant passes formatting, lint, strict
TypeScript and 11 synthetic worker tests; the complete available hosted harness
passes 77 tests and the dependency audit reports zero vulnerabilities. It leases
one dispatch, binds the result to the exact upload-manifest fingerprint, retains
blocked previews as non-confirmable and publishes no partial evidence after
processor failure. Its three implementation, test and contract blobs match the
validated hosted files, and the exact head has no workflow run, status context or
pull request.

The authenticated import owner-action descendant passes formatting, lint,
strict TypeScript and six synthetic action tests; the complete available hosted
harness passes 83 tests. Its production dependency audit reports zero
vulnerabilities; the isolated ESLint development tree retains the known no-fix
brace-expansion advisory. The service resolves Clerk identity inside each
request, rejects a non-owner before provider access and preserves explicit
not-configured states. Its three implementation, test and contract blobs match
the validated hosted files, and the exact head has no workflow run, status
context or pull request.

The fail-closed import Server Action descendant passes formatting, lint,
strict TypeScript and four synthetic adapter tests; the complete available hosted
harness passes 87 tests and the production dependency audit reports zero
vulnerabilities. It resolves Clerk identity inside every invocation, accepts no
browser owner ID and supplies only explicit unavailable provider capabilities.
Its three implementation, test and contract blobs match the validated hosted
files, and the exact head has no workflow run, status context or pull request.

The bounded direct-upload descendant passes formatting, lint, strict TypeScript
and seven synthetic orchestration tests; the complete available hosted harness
passes 94 tests and the production dependency audit reports zero vulnerabilities.
It maps every selected Blob to one opaque reserved target, transfers sequentially
without a whole-file read and requests completion only after every object
succeeds. Its three implementation, test and contract blobs match the validated
hosted files, and the exact head has no workflow run, status context or pull
request.

The bounded file-preparation descendant passes formatting, lint, strict
TypeScript and seven synthetic preparation tests; the complete available hosted
harness passes 101 tests and the production dependency audit reports zero
vulnerabilities. It reads selected private CSVs sequentially in bounded slices,
feeds an injected incremental SHA-256 state and reports only synthetic IDs and
byte counts. Its three implementation, test and contract blobs match the
validated hosted files, and the exact head has no workflow run, status context
or pull request.

The authenticated confirmation descendant passes formatting, lint, strict
TypeScript and six synthetic confirmation/transport tests; the complete
available hosted harness passes 107 tests and the production dependency audit
reports zero vulnerabilities. It resolves Clerk identity per request, requires
explicit acknowledgement and delegates only to the guarded activation service.
All four activation capabilities remain explicitly unavailable. Its five
implementation, test and contract blobs match the validated hosted files, and
the exact head has no workflow run, status context or pull request.

The authenticated recovery descendant passes formatting, lint, strict
TypeScript and six synthetic recovery/transport tests; the complete available
hosted harness passes 113 tests and the production dependency audit reports zero
vulnerabilities. It requires owner identity, a durable batch, meaningful reason,
idempotency and explicit acknowledgement while the transactional rollback
repository remains unavailable. Its five implementation, test and contract
blobs match the validated hosted files, and the exact head has no workflow run,
status context or pull request.

The authenticated aggregate-refresh retry descendant passes formatting, lint,
strict TypeScript and nine synthetic retry/transport tests; the complete
available hosted harness passes 122 tests and the production dependency audit
reports zero vulnerabilities. It reserves and queues only failed refresh work,
preserves exact queued replay and records sanitized queue failure while both
provider capabilities remain unavailable. Its five implementation, test and
contract blobs match the validated hosted files, and the exact head has no
workflow run, status context or pull request.

The import progress and completion UI descendant passes formatting, lint, strict
TypeScript and eight new synthetic projection/component tests; the complete
available hosted harness passes 18 test files and 130 tests and the production
dependency audit reports zero vulnerabilities. It separates received,
validation, accepted activation, aggregate publication, review-required,
historical-view-ready and rolled-back evidence while keeping provider actions
disabled. Its five new implementation, test and contract blobs match the
validated hosted files byte-for-byte; the exact eight-file delta has no workflow
run, status context or pull request.

The lazy import provider adapter bundle passes formatting, lint, strict
TypeScript and five new synthetic owner-binding/lazy-initialization tests; the
complete available hosted harness passes 19 test files and 135 tests and the
production dependency audit reports zero vulnerabilities. It denies non-owners
before factory access, reports incomplete bundles deterministically and reuses
one owner-bound initialization promise without provisioning a provider. Its
three implementation, test and contract blobs match the validated hosted files
byte-for-byte; the exact five-file delta has no workflow run, status context or
pull request.

The owner-scoped persistence operation adapter passes formatting, lint, strict
TypeScript and nine new synthetic isolation/idempotency tests; the complete
available hosted harness passes 20 test files and 144 tests and the production
dependency audit reports zero vulnerabilities. It establishes transaction-local
owner scope, verifies the exact Clerk/database-owner binding and requires both
enabled and forced RLS before reserving durable work. Exact fingerprints replay;
conflicts roll back. Its three implementation, test and contract blobs match the
validated hosted files byte-for-byte; the exact five-file delta has no workflow
run, status context or pull request. Live database policy execution remains
gated.

The independent incremental SHA-256 descendant passes formatting, lint, strict
TypeScript and seven new vector/integration tests; the complete available hosted
harness passes 21 test files and 151 tests and the production dependency audit
reports zero vulnerabilities. Published empty, abc, long-message and million-a
vectors pass, as do one-byte and 63/64/65-byte boundaries and bounded file
preparation. Its three implementation, test and contract blobs match the
validated hosted files byte-for-byte; the exact five-file delta has no workflow
run, status context or pull request. No form or provider is enabled.

The Neon persistence descendant passes formatting, lint, strict TypeScript and
six new driver tests; the complete available hosted harness passes 22 test files
and 157 tests and the production dependency audit reports zero vulnerabilities.
All six implementation, test, migration and contract artifacts match the
validated hosted files byte-for-byte; the exact nine-file delta has no workflow
run, status context or pull request. Migration 0010 contains forward, synthetic
smoke and reverse SQL and is wired into the future migration job, but PostgreSQL
execution remains pending because this workspace has no PostgreSQL runtime.
No database URL, provider connection, Preview import or Production capability is
enabled.

The Cloudflare R2 private-object descendant passes formatting, lint, strict
TypeScript and 13 new synthetic adapter tests; the complete available hosted
harness passes 23 test files and 170 tests and the production dependency audit
reports zero vulnerabilities. It verifies private-bucket evidence before every
lazy provider path, issues only exact-account HTTPS SigV4 PUT targets, uses
opaque quarantine keys and exposes bounded HEAD/GET operations without LIST,
DELETE or public URLs. Its three implementation, test and contract blobs match
the validated hosted files byte-for-byte; the exact five-path delta has no
workflow run, status context or pull request. R2 credentials, bucket/CORS
configuration, real private objects, Preview imports and Production remain
unconfigured.

The Cloudflare import-queue descendant passes formatting, lint, strict
TypeScript and ten new synthetic adapter tests; the complete available hosted
harness passes 24 test files and 180 tests and the production dependency audit
reports zero vulnerabilities. It keeps preview and background delivery separate,
requires active consumers, bounded retries and dead-letter queues, and sends only
compact redacted JSON keyed by durable dispatch IDs. Its three implementation,
test and contract blobs match the validated hosted files byte-for-byte; the
exact five-path delta has no workflow run, status context or pull request. Real
queues, bindings, messages, Preview imports and Production remain unconfigured.

Hosted validation is useful staging evidence but is not a substitute for
mandatory exact-head Actions.

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

### Discovery, Tournament, Maiden and Breeding reads

Read compact owner-scoped materialized evidence without scanning raw history,
preserve exact mode/distance and configured qualification authority, treat
historical fields and current ME snapshots honestly, keep the 50% gate as a
hard cap, preserve ME for the strongest mode-specific opportunity and disable
all automatic entry or entitlement mutation.

Breeding reads retain separate elite-upside and Vault-gap rankings, require
durable parent IDs, hold unsupported or stale evidence and preserve Arena
freshness/live-confirmation boundaries with Gate E unpassed.

### Manual ledger writes and reversals

Validate exact owner-entered entries before persistence, retain original-asset
and BGC separation, make identical durable-ID replay idempotent, block conflicts
and record corrections as exact opposite append-only postings without mutating
source evidence. Provider persistence and forms remain disabled.

### Manual tournament payouts and reconciliation

Validate exact external prizes and allocations before persistence, keep genuine
vault-level payouts unallocated where appropriate, detect imported payout
candidates conservatively and require a reasoned duplicate or separate-payment
decision. Confirmed duplicates exclude only the manual payout; imported facts
remain immutable. Provider persistence and forms remain disabled.

### Lifecycle sale, burn and BGC writes

Record only confirmed completed sale and burn evidence, preserve exact
asset-separated proceeds, fees and cost-basis limitations, reject Genesis burn
evidence and retain historical lineage. Reconcile actual BGC credits separately
without predicting an amount, mutating ownership or automatically posting the
ledger. Provider persistence and forms remain disabled.

### Lifecycle economic replay hardening

Canonicalize timestamps, asset identifiers, exact decimals and optional
references before durable fingerprinting. Resolve an existing burn-credit ID
before burn-scope reconciliation so exact replay is idempotent while different
evidence conflicts, and keep multiple genuinely distinct credits
review-required without a posting proposal.

### Breeding economic writes and offspring cost basis

Record only owner-confirmed completed/refunded breeding economics, keep Arena
listings and incomplete activity non-transactional, preserve exact original-asset
and BGC separation, and assign actual pairing costs only to a confirmed owned
offspring after owner-scoped duplicate checks. Durable replay precedes duplicate
lookup; no splice, wallet, ledger, ownership, market-value or realised-gain action
is enabled.

### Guarded import upload intake

Reserve only bounded owner-authenticated CSV metadata after the approved capacity
gate, allow grouped Race Merge files and one replacement candidate per snapshot
family, and issue opaque short-lived direct private-object targets. Keep source
bytes out of application memory and leave preview, activation, providers and
Production disabled.

### Upload completion and preview dispatch

Verify the owner-scoped private objects against durable reserved metadata, keep
incomplete direct uploads pending and reserve one idempotent preview dispatch only
after every object agrees. Preserve mandatory full-stream SHA-256 verification in
the preview worker, sanitize provider failures and leave schema acceptance,
confirmation, active versions, providers and Production disabled.

### Bounded import preview processing

Lease one durable preview dispatch, stream and inspect only the persisted private
object manifest, and bind the deterministic preview to that exact manifest
fingerprint. Validate source-family and blocking-state summaries before
publication, keep blocked previews non-confirmable and leave owner confirmation,
source activation, providers and Production disabled.

### Authenticated import owner actions

Resolve Clerk identity inside each server request and delegate only to the
existing guarded upload-intake and upload-completion services. Never accept a
browser owner ID, initialize providers at module scope or expose file bytes,
preview bodies, active versions, freshness or recommendations. Provider adapters,
forms, owner confirmation, Preview imports and Production remain disabled.

### Fail-closed import Server Actions

Expose the validated owner intake and completion boundaries as Next.js Server
Actions while resolving Clerk identity inside every request and accepting no
browser owner ID. Keep provider capabilities explicitly unavailable, so no
upload target, persistence write, object inspection, queue dispatch, source
activation, Preview import or Production action is possible.

### Bounded direct private-object upload client

Match each selected Blob and prepared candidate to one opaque reserved target,
reject expired or inconsistent sets before transfer, upload sequentially through
an injected private transport without reading whole files into application
memory, and request idempotent completion only after every object succeeds.
Checksum preparation, provider adapters, forms, Preview imports, source
activation and Production remain disabled.

### Bounded private import file preparation client

Normalize one grouped private CSV selection, read every Blob sequentially in
bounded slices and feed an injected incremental SHA-256 state before guarded
intake. Preserve the original Blob by reference and expose only synthetic IDs
and byte counts as progress. The hashing implementation, form, object-store
adapter, persistence, Preview imports, source activation and Production remain
disabled.

### Authenticated import confirmation

Resolve Clerk identity inside each confirmation request, require the durable
preview identity, persisted fingerprint, idempotency key and explicit owner
acknowledgement, then delegate to the existing capacity/raw-object/dispatch
controls. Keep every provider capability unavailable so this boundary cannot
activate a source version, import private data or change Production.

### Authenticated import recovery

Resolve Clerk identity inside each rollback request, require the durable active
batch, meaningful reason, idempotency and explicit owner acknowledgement, then
delegate only to the transactional recovery repository. Preserve provenance,
restore only a prior accepted version and require a fresh aggregate refresh.
Keep persistence unavailable so no rollback or provider mutation can occur.

### Authenticated aggregate-refresh retry

Resolve Clerk identity inside each retry request, require a durable failed
refresh, meaningful reason, idempotency and explicit owner acknowledgement, then
reserve and queue only one owner-scoped retry. Preserve queued replay, sanitize
queue failures and keep source-version validation, bounded computation and
atomic publication in the worker. Keep repository and queue providers
unavailable so no aggregate or recommendation can change.

### Import progress and completion UI

Project compact owner-scoped batch evidence into received, validation, accepted
activation, aggregate publication and readiness stages. Keep quarantined attempts
from advancing freshness, retain material review work after publication, show
rollback as recovered evidence and keep every upload, confirmation, retry and
rollback control disabled until approved provider adapters are configured.

### Import provider adapter bundle

Require the authenticated owner and complete persistence, private-storage,
preview-queue, background-queue and capacity-gate configuration before returning
a server-only bundle. Bind factories to the verified owner, initialize lazily and
once, and keep concrete providers, secrets, private data and Production outside
the contract. Keep the browser incremental hasher separate and do not treat
bundle readiness as proof of database RLS or operation-level idempotency.

### Import persistence operation adapter

Bind one lazy persistence driver to the verified Clerk owner and configured
database-owner UUID. Establish transaction-local owner scope, verify the exact
owner mapping plus enabled and forced RLS, and reserve only canonical durable
operations. Replay only an exact request fingerprint; conflicting evidence rolls
back. Keep the live Neon driver, schema, credentials and Preview execution
disabled.

### Browser incremental SHA-256

Hash each private browser-selected export through bounded byte chunks using one
fixed-memory state. Validate standard vectors and chunk boundaries, finalize
idempotently and carry no owner, filename, provider or storage capability. Keep
the background preview stream authoritative and leave the form and providers
disabled.

### Neon import persistence driver

Open one short-lived Neon WebSocket pool only after configured use, execute owner
scope, Clerk binding, live forced-RLS evidence and durable reservation in one
serializable transaction, and close on success or rollback. Apply reversible
migration 0010 before connecting the driver. Keep the database URL, providers,
private-source execution, Preview imports and Production disabled.

### Cloudflare R2 private import object storage

Bind one lazy private-object adapter to the verified owner, require public
access, r2.dev and custom domains to be disabled, issue only content-type-bound
short-lived SigV4 PUTs on the exact account S3 endpoint, and stream quarantined
objects without buffering. Keep provider checksum metadata advisory and require
the existing exact full-stream byte/SHA verification before staging commits.
Expose no list, delete, public URL, credentials, provisioning, Preview activation
or Production operation.

### Cloudflare import queues

Bind one lazy producer to the verified owner, keep preview and background work
on separate queues, require a consumer, bounded retries and a dead-letter queue,
and send only version, work kind, durable dispatch ID and an opaque owner scope.
Treat delivery as at least once and leave durable repository claims authoritative
for replay. Require future consumers to acknowledge or retry every message
independently. Keep provisioning, bindings, real messages, Preview activation
and Production disabled.

### Import provider capacity

Bind one lazy capacity port to the verified owner, measure upload and activation
projections separately, and require fresh provider API evidence for R2 storage,
R2 Class A/B operations, Neon storage and queue backlog. Reserve configured
headroom, reject missing, duplicate, stale, future or malformed evidence, and
stop before upload or activation when projected use crosses usable capacity.
Eight new synthetic tests pass inside the complete 25-file/188-test hosted
harness; all three implementation, test and contract blobs reconcile exactly.
Keep real provider measurements, paid-tier changes, private uploads, Preview
activation and Production disabled.

### Vault Performance economic actions

Resolve Clerk identity inside every manual ledger entry, append-only reversal,
tournament payout and payout-reconciliation action, and never accept owner
identity from the browser. Delegate only to the existing exact asset-separated
services while both repositories remain explicitly unavailable. Five new
synthetic tests pass inside the complete 26-file/193-test hosted harness; all
three action, test and contract blobs reconcile exactly. No wallet, game,
ownership, private-record or Production operation is possible.

### Lifecycle, Open Race and readiness reads

Lifecycle preserves unresolved value, forbids Genesis burn, keeps actual BGC
burn credit outside action ranking and disables sale, burn and ledger mutation.
Open Race binds manual field input, eligibility, exact-distance ranking, lock,
optional star observation and diagnostic comparison without allowing current
stars into Stage A or switching after lock. Readiness displays exact-head checks
and blockers while remaining non-executable and keeping Gate F client-only.

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

## Remaining no-Actions programme before 1 August

1. Connect the staged Neon, R2, Queue and capacity adapters only after
   migration 0010, private-bucket/CORS, queue-consumer/DLQ and provider-capacity
   evidence exist. Keep provisioning, secrets, private-source execution and the
   direct-upload form disabled until the full bundle has connected
   synthetic/hosted evidence.
2. Add accessible authenticated forms for the staged manual ledger and
   tournament-payout actions, then add action boundaries and forms for breeding
   and lifecycle economic services while keeping wallet and game actions
   impossible.
3. Continue Phase 9 chronological, freshness, recovery, capacity, security,
   accounting and accessibility evidence where the supplied history supports
   it; preserve unavailable Maiden and breeding evidence honestly.
4. Rehearse the cumulative hosted composition, run all available formatting,
   lint, strict types, TS/TSX tests, build, audit and privacy scans, and keep
   every exact branch head and limitation current in this queue.
5. Prepare the 1 August exact-head Actions sequence without opening or updating
   PRs, merging, dispatching workflows, changing providers or touching
   Production.

Real Preview import, connected-provider capacity, PostgreSQL migration
execution, deployed request latency, formal Gates B-E acceptance where evidence
is unavailable, every exact-head Actions run and Gate F remain outside this
no-Actions programme.

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
