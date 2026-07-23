# Phase 9 Snapshot Freshness Validation

## Purpose

Validate the freshness disclosure used by imported race, core, Vault and Arena
surfaces without confusing historical coverage, import completion or aggregate
refresh.

## Contract

- Preserve `Data current through`, `Last imported` and aggregate refresh as
  separate timestamps.
- Represent not-imported and imported-with-unknown-coverage states explicitly.
- Apply configurable current, ageing and stale thresholds to the accepted
  historical cutoff.
- Reject future or chronologically impossible timestamp combinations.
- Disclose a pending aggregate refresh independently of source age.
- Require warning treatment for ageing data and review treatment for stale data.

## Boundary

Freshness changes confidence and warnings only. It does not rewrite accepted
historical facts, infer missing later events or authorise any claim that
periodically imported state is live.
