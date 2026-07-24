# Phase 9 Large-History Capacity Audit

This contract audits measured capacity evidence for the expected multi-million-row
race history. Representative evidence must use sanitized or private hosted data
at no fewer than two million rows, repeat measurements against one exact
repository head and disclose routine-request latency and background peak memory
against explicit budgets.

Routine page requests must use compact precomputed aggregates and scan zero raw
race-history rows. Imports and aggregate refreshes must remain off the request
path and use a positive bounded batch size.

Synthetic fixtures validate the deterministic auditor only. They cannot prove
representative capacity, satisfy Production readiness or accept Gate F. The
audit cannot change a provider, mutate Production or expose private values in
logs.
