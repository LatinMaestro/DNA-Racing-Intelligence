# Phase 2A Core Economic Profile

## Scope

This deterministic contract builds an economic profile for one authoritative
core ID and one inclusive reporting period.

It reports only exact transaction amounts explicitly allocated to that core.
Related vault-level or shared activity remains visible as unallocated evidence
and does not enter the core's totals.

## Allocation boundary

An explicitly allocated transaction must:

- use unique authoritative core IDs;
- preserve the source transaction's debit or credit direction;
- allocate the entire exact source amount; and
- retain inclusion/exclusion and reconciliation state.

The profile uses only the selected core's exact share. It never repeats the
whole transaction against every related core.

Records may instead identify related cores without allocating an amount. Those
records produce a warning and count but no per-core income, expense or profit.

## Profile components

For each original asset the profile exposes:

- open-race fees and payouts;
- tournament entry fees and attributable payouts;
- breeding income and expenses;
- acquisition costs;
- sale proceeds and selling fees;
- actual manually recorded burn BGC and allocated BGC breeding spend;
- other recorded lifecycle income and expenses;
- recorded net cashflow; and
- realised trading result where cost basis is known.

Cash, crypto and BGC remain separate. No unlike-asset combined total is
available.

## Cost-basis integrity

Sale proceeds remain visible when acquisition cost is missing or recorded in an
unconverted different asset, but realised trading gain/loss is unavailable and
the profile is partial. A trading result is calculated only where cost-basis
coverage is explicitly known in the same asset. Unsold-core market value is
outside this contract and never enters realised P/L.

## Completeness and warnings

The profile discloses:

- incomplete source coverage;
- missing cost basis;
- unresolved reconciliation;
- related shared activity that remains unallocated; and
- an unknown imported-data cutoff.

`complete_recorded_period` applies only to the stated recorded coverage and
never permits a complete-lifetime-profit claim.

## Deferred work

Persistence, allocation UI, cost-basis evidence workflows, lifecycle state,
dashboard presentation and hosted private data remain separate slices.
Exact-head GitHub CI remains mandatory before merge, and Production remains
disabled.
