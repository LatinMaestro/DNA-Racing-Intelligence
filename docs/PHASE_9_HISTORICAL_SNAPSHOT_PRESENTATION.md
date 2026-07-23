# Phase 9 Historical-Snapshot Presentation Audit

## Purpose

Automatically verify that race-derived recommendation surfaces disclose their
periodic historical source and do not present imported opponents, listings or
recommendations as live game state.

## Contract

- Require a visible historical-snapshot label.
- Require separate `Data current through` and `Last imported` labels.
- Require a visible current-import, ageing, stale, unknown or not-imported
  freshness label.
- Reject affirmative live, real-time and up-to-date imported-state claims.
- Permit explicit disclosures that the application is not live.
- Require Open Race pages to distinguish the manually entered current field
  from imported historical evidence.

## Boundary

Passing the text audit proves only that required wording is present. It does not
prove source freshness, analytical accuracy, a live integration, Production
approval or Gate C acceptance.
