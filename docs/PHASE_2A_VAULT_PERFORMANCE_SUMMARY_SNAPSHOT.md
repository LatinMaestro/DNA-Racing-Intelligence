# Compact Vault Performance summary snapshot boundary

Status: offline dependency preparation, 15 October 2026. No persistence,
publication, route wiring or connected acceptance is claimed by this slice.

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

The next slice still needs compact summary persistence with forced owner RLS,
least-privilege function-only runtime access and bounded reads; a separately
guarded materializer must reuse the existing calculator against authoritative
ledger/classification/coverage state. Publication must verify that exact source
state, preserve last-good on conflict/failure and remain invalidated or visibly
outdated after relevant ledger corrections. This codec does not solve those
publication/concurrency obligations or authorize a source scan.

After that dependency is available, wire the existing private page and test
owner denial before persistence, rollback/close paths and connected retained-
data reconciliation. The page continues to inject the unavailable repository in
this slice. USD valuation, per-Core reporting, ledger forms and other module
adapters remain separate requirements.

Synthetic tests cover precision beyond JavaScript's safe-integer range,
sub-wei-style fractional precision, separate ETH/DEZ/BGC, transfers outside
operating totals, missing cost basis, partial coverage, stale reads, unknown
dates, owner/source mismatch, altered bytes, malformed money and payloads,
future evidence, detached returned values and the payload ceiling. They are
preparatory regression evidence, not real owner-data commissioning.

Fresh metadata on 15 October still reports Neon October transfer of
5,695,839,591 bytes, above the owner's operating ceiling. No owner SQL, R2 data
access, deployment or game action is needed for this slice. Friday 16 October
connected commissioning remains blocked unless fresh positive A$0 capacity is
verified independently for every affected provider.
