# Phase 2A Tournament Payout Allocation FormData

## Scope

This boundary extends the strict manual tournament payout parser with bounded,
method-specific repeated allocation rows. It does not enable the visible form,
connect persistence or create wallet, game or Production capability.

## Accepted allocation methods

- `vault_unallocated` accepts no core-allocation fields.
- `single_core` accepts exactly one core row.
- `equal` accepts one or more core rows and delegates deterministic
  largest-remainder apportionment to the authoritative payout domain.
- `manual_amounts` requires one exact amount for every core and must reconcile
  exactly to the payout at the server-configured asset precision.
- `manual_percentages` requires one positive exact percentage for every core
  and must total exactly 100.
- `documented_points` requires one positive integer points value for every
  core and delegates deterministic largest-remainder apportionment.

## Safety rules

- Unknown fields, non-text values, duplicate scalar fields and browser durable
  IDs remain rejected.
- Repeated fields are bounded to 100 rows and 128-character core IDs.
- Core IDs must be unique and are ordered deterministically.
- Allocation values are paired with core IDs by submitted row order before
  deterministic ordering.
- Fields that do not belong to the selected method are rejected.
- BGC remains unavailable for manual tournament payouts.
- Asset kind and precision remain server-controlled.
- The existing authoritative payout domain performs exact reconciliation and
  rejects zero allocations, malformed values and precision loss.

## Deferred activation

The Server Component form remains disabled until accessible conditional-row
controls, authenticated action feedback and forced-RLS Preview persistence are
connected together. No provider, private record or Production state changes in
this slice.
