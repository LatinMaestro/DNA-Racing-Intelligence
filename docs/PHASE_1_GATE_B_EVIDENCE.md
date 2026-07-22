# Phase 1 Gate B Evidence and Client Handoff

Date: 23 July 2026  
Gate status: **not yet accepted**  
Production: disabled and fail-closed

## Purpose

Gate B must be satisfied before any full private export or economic record is uploaded to hosted infrastructure. Repository-only and synthetic work is complete enough to identify the remaining decisions precisely; it does not authorise a private Preview import.

## Evidence complete

### Schema, privacy and access

- Reversible PostgreSQL migrations define owner-scoped import manifests, normalized facts, immutable dataset versions, lineage, snapshots, identity review, star reconciliation and exact asset-separated accounting foundations.
- Forced row-level security protects private tables, `PUBLIC` table/function access is revoked, and CI verifies apply, owner isolation, rollback, complete reversal and schema teardown.
- Clerk plus a server-side owner allowlist remains the approved single-user identity boundary. Missing Preview configuration fails closed; Production builds and requests remain disabled.
- Routine adapter and workspace summaries expose source type, state, timestamps, counts and stable issue codes only. Filenames, raw headers, names, wallet references, economic records and row values are excluded from redacted output.

### Retention, deletion and recovery

- Accepted versions, source contributions and provenance are retained for audit until an explicit owner deletion workflow is invoked.
- Current Vault and Arena imports retain historical snapshots while exposing exactly one current snapshot.
- Reasoned rollback restores the prior accepted version without deleting source evidence.
- Raw private objects are designed for a private Standard-storage bucket with no public access. Automatic raw-file deletion is not enabled; deletion of private source data remains client-only.
- Database deletion and reverse-migration behaviour is covered by synthetic PostgreSQL checks. No persistent hosted database has been changed.

### Star and freshness integrity

- Raw and nullable normalized Gold/Blue values remain distinct from missing, partial and invalid states.
- Gold eligibility is derived only from `gate_count > 3`.
- One- to three-gate source Gold is retained as an anomaly and excluded from positive or negative Gold evidence.
- Event-level zero, unique and multiple assignments remain distinct; ambiguous assignments never select a false winner.
- Gold and Blue completeness and denominators are independent and auditable.
- Manual post-lock observations remain separate and cannot duplicate authoritative imported evidence.
- Data current-through, import completion and aggregate refresh timestamps remain separate. Current, ageing, stale and unknown states do not change accepted facts or imply live data.

### Deduplication and accounting safeguards

- Dataset, race-entry, source-contribution and manual-observation keys are deterministic and replay-safe.
- Repeated imports, snapshot replacement, conflict quarantine, stale regression and rollback pass synthetic tests.
- Exact economic values are asset-specific, BGC remains separate, and transfers are structurally excluded from operating P/L.
- Arena listings are availability/price evidence only and cannot create income or expense.
- Race Merge economic source values remain quarantined as unvalidated; no race-derived transaction is created from them.
- Manual external payout, correction, reversal and reconciliation records have schema foundations, but authenticated entry and Preview verification remain pending.

## Current service-cost boundary

Official pricing checked on 23 July 2026:

- [Vercel Hobby](https://vercel.com/docs/plans/hobby) is US$0 within its included personal-project limits.
- [Clerk Hobby](https://clerk.com/pricing) is US$0 within its published retained-user limits.
- [Cloudflare R2 Standard](https://developers.cloudflare.com/r2/pricing/) includes 10 GB-month storage, one million Class A operations and ten million Class B operations monthly.
- [Neon Free](https://neon.com/pricing) includes 0.5 GB storage and 100 CU-hours per project monthly; Launch is usage-based and Neon describes an intermittent 1 GB workload as typically about US$15/month.

The detailed PostgreSQL model retains normalized rows, immutable acceptance facts and provenance in addition to the raw exports. The supplied private capacity profile must not be committed, but it indicates that the Neon 0.5 GB allowance cannot safely be assumed sufficient. No paid plan or architecture change is authorised by this document.

## Evidence still required

### 1. Authoritative Race Merge economic semantics

The source fee, payout, prize and asset fields cannot safely enter P/L until the owner provides an authoritative export legend or confirms, for every field:

- asset or currency;
- integer/decimal unit and precision;
- whether the value is per entry, per core or per event;
- debit/credit direction and sign convention;
- gross versus net treatment;
- included race/tournament stages;
- refund and reversal representation; and
- the meaning of zero, blank and missing values.

This answer materially changes financial totals and cannot be inferred.

### 2. Preview storage choice and cost approval

Choose one path after reviewing the private capacity estimate:

- approve a capped usage-based Neon Preview database and its maximum monthly spend; or
- approve a documented architecture amendment that keeps detailed normalized history in private R2 analytical storage and only application state/aggregates in Neon.

The second option is a material architecture change and requires explicit approval before implementation.

### 3. Client-owned Preview configuration

After items 1 and 2 are resolved, the owner must create or grant access to the approved Preview-only Clerk, Neon, private R2 and Vercel resources and add their secrets through provider dashboards. Secrets must never be pasted into Git, source files, PR comments or chat output.

The first private upload remains a deliberate client action. Production, custom domains and recurring paid infrastructure remain separately gated by Gate F.

## Work unlocked

The consolidated client response unlocks:

1. the exact race-derived fee/payout pipeline and duplicate-safe accounting tests;
2. authenticated Preview loaders, upload and reasoned recovery mutations;
3. a sanitized representative Preview import and private capacity measurement;
4. Gate B final evidence, self-acceptance where permitted and Phase 2 delivery.
