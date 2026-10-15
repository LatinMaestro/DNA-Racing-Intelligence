# Compact Vault Performance summary snapshot boundary

Status: offline dependency preparation, 15 October 2026. The codec now has
compact storage/read-adapter code and synthetic acceptance. No hosted migration,
source publication, route wiring or connected acceptance is claimed.

## Purpose and method traceability

The existing workspace requires at most one compact owner-scoped summary per
read. Scanning the raw economic ledger during a page request is prohibited.
Before adding its persistence adapter, define the exact bounded payload that
may cross that boundary. This is part of the next Vault Performance dependency
recorded in Issue #120, not a replacement analytical model.

`lib/vault-performance-summary-snapshot.ts` encodes and decodes only the existing
`VaultPerformanceSummary`. It reuses the workspace's existing validation and
freshness policy, now exported as `normalizeVaultPerformanceReadSummary`.
`domain/vault-performance-summary.ts`, its calculations and its tests remain
unchanged. No new economic category, formula, conversion, ranking, probability
or completeness policy is introduced.

## Payload contract

- Version 1 binds the database owner UUID, an expected canonical source-ledger
  SHA-256 identity, materialization time and the complete approved summary.
- Canonical JSON has deterministic object-key order. Existing array order and
  exact decimal strings are preserved; money never passes through Number.
- The payload is capped at 256 KiB as a transport/storage safety limit. An
  oversized summary is rejected in full, never truncated or silently sampled.
- Required summary and asset-total fields must all exist. Unknown fields,
  numeric or null monetary values (except the approved unavailable realised
  trading result), accessors, malformed types, invalid counts, duplicate assets
  and unsupported claims are rejected. Raw rows, wallet payloads and private
  transaction details have no field in this contract.
- Materialization cannot follow trusted server time. Neither an accepted event
  cutoff nor import time can follow materialization. Existing event-before-
  import validation also remains in force; unknown timestamps remain unknown.
- Decoding verifies the expected body checksum, owner and source identity, then
  rejects noncanonical bodies, duplicate JSON keys and unsupported versions.
  Current freshness is re-derived at read time without changing financial
  totals. Errors contain no submitted evidence values.

A checksum proves byte integrity, **not** financial truth, source completeness,
owner authentication or permission to publish. The caller must obtain the
expected owner/source/checksum from trusted owner-scoped persistence. The
source-ledger digest must identify the exact accepted ledger/correction state
used by the materializer; a caller-provided arbitrary digest is not authority.

## Remaining dependency and acceptance

Migration `0125` adds one at-most-256-KiB snapshot slot per owner with forced
owner RLS, envelope metadata/checksum constraints and a fixed-search-path,
function-only runtime read. PUBLIC receives no function access, and the runtime
receives no direct table read/write permission or publication function. Reversal
removes only this new read model/function; it does not alter the economic ledger.
No hosted migration is applied during the quota block.

`lib/neon-vault-performance-summary-repository.ts` implements the existing
workspace repository contract. It binds the configured Clerk owner before opening
persistence, verifies exact database owner/Clerk identity, actual session/current
roles, least privilege, forced RLS and absence of direct table access. A repeatable-
read, read-only transaction sets local statement/lock timeouts and owner scope.
A required **trusted source identity reader** runs within that same transaction;
it must read compact canonical ledger/correction authority, never a raw-ledger
scan, form value or environment-supplied hash. Unknown source returns no report.
The SQL function returns zero or one row matching that exact source digest; the
codec then checks body integrity, owner/source binding, types, monetary precision,
coverage and current freshness. Missing/superseded summaries return no report;
corrupt or duplicate results and database failures fail closed, roll back and close
without returning provider error values.

The adapter is intentionally not constructed by the route. There is no production
source-identity reader or publication/materializer API in this slice. Environment
variables or an arbitrary body checksum cannot make a report authoritative.
`lib/vault-performance-summary-materializer.ts` now supplies the guarded
calculator-to-snapshot coordinator. It loads one trusted canonical source state,
reuses `buildVaultPerformanceSummary` and the existing codec, and submits a
single owner/source-bound candidate to a required compare-and-swap publisher.
Unknown source authority does not publish; unchanged and concurrently superseded
states are non-destructive, and provider/source failures expose no protected
values. The publisher contract must compare the expected source digest in the
same transaction as publication and preserve last-good on mismatch.

The production canonical source adapter and compare-and-swap publisher are still
intentionally absent. Next map the accepted ledger, classification,
reconciliation, correction, cost-basis and coverage authority into that contract
and derive its compact source-state identity in trusted owner-scoped persistence.
Relevant corrections must invalidate the source identity in the same accepted
state transition; an older summary then cannot match a new source identity. A
form, environment value or snapshot-body hash cannot implement this contract.
Until those production dependencies exist, do not populate the slot or wire the
page. The storage checks are transport integrity, not financial truth.

After that dependency is available, wire the existing private page and test
owner denial before persistence, rollback/close paths and connected retained-
data reconciliation. The page continues to inject the unavailable repository.
USD valuation, per-Core reporting, ledger forms and other module adapters remain
separate requirements. Existing `domain/vault-performance-summary.ts` and its
accounting tests are unchanged; adapter tests preserve exact totals, separate
assets/BGC, non-operating transfers and partial/stale coverage.

SQL smoke fixtures intentionally test envelope storage, function permissions,
invalid mutations, null/missing scope, source mismatch and forced RLS as a
non-bypass table owner. They are not accounting summaries or real-data acceptance;
the TypeScript tests use full calculator-generated summaries through the codec
and workspace service. CI applies/smokes/reverses/removes the migration only in
ephemeral PostgreSQL. Hosted PostgreSQL 18 compatibility/owner-role acceptance
remains part of bounded commissioning; current CI PostgreSQL 16 success is not
proof of a connected Neon migration.

Synthetic tests cover precision beyond JavaScript's safe-integer range,
sub-wei-style fractional precision, separate ETH/DEZ/BGC, transfers outside
operating totals, missing cost basis, partial coverage, stale reads, unknown
dates, owner/source mismatch, altered bytes, malformed money and payloads,
future evidence, detached returned values, concurrent-source rejection,
non-destructive last-good outcomes and the payload ceiling. They are
preparatory regression evidence, not real owner-data commissioning.

Fresh metadata on 15 October still reports Neon October transfer of
5,695,839,591 bytes, above the owner's operating ceiling. No owner SQL, R2 data
access, deployment or game action is needed for this slice. Connected commissioning remains blocked until fresh positive A$0 capacity is
verified independently for every affected provider after the expected November
reset, with the required efficiency safeguards in place. Code/fixture work
continues now under the latest owner priority amendment in Issue #120.
