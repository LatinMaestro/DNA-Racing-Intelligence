# Phase 9 Hosted Capacity Attestations

## Boundary

This evidence-only contract binds capacity and performance claims to one exact
candidate head, one reviewed capacity manifest and one synthetic workload
manifest. It does not execute workloads or configure providers.

Required controls cover bounded streaming memory, preview row budgets, queue
throughput and recovery, database and object-storage capacity, authenticated
request and aggregate-refresh latency, provider quota headroom and fail-closed
degradation.

## Evidence rules

- Use only fixed reviewed command identities.
- Record exact UTC bounds, complete assertions and a redacted summary digest.
- Compare a non-negative observed value with a positive approved limit.
- Require complete synthetic workloads without retained private artifacts.
- Require connected evidence for provider-backed controls.
- Treat missing controls as review-required.
- Block stale heads, manifest drift, failed or incomplete workloads,
  over-limit results, private-data observation and unconnected provider claims.

## Authority

The projection cannot dispatch Actions, merge, mutate providers, activate paid
services or change Production. Provider-backed execution and real request
latency remain unclaimed until connected Preview evidence exists.
