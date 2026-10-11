# Phase 4 Tournament Workspace

Status: owner-scoped read boundary integrated for review; mutations, providers
and deployment remain disabled.

## Purpose

The private Tournaments route reads compact, materialized candidate evidence
only after the authenticated Clerk owner matches the server-side allowlist. It
does not scan raw Race Merge history on a routine request.

## Preserved rules

- Tournament rules are versioned configuration, never reconstructed from
  historical exports.
- Split and leaderboard-group labels are rendered explicitly. Candidates and
  legitimate ties remain ranked only within their own group.
- Each candidate set is bound to the exact tournament configuration version and
  candidate-snapshot version used to produce it.
- Candidate order follows only the configured qualification metric. Historical
  stars may explain evidence but cannot determine the order.
- Imported history is a historical snapshot, not the current qualifying field.
- The 50% race-gate rule is a hard cap, not a target.
- Maiden eligibility is preserved for the strongest credible mode-specific
  opportunity.
- Unknown or missing evidence is unavailable, never favourable or zero.
- Every candidate remains experimental and non-actionable while Gate C is
  unpassed.
- Candidate cards disclose their own accepted historical cutoff, last import
  timestamp and freshness, including stale/unknown, rather than implying one
  tournament-wide dataset is complete or continuously live.
- The calibrated same-group tournament-field P(win), probability of achieving
  the configured qualification metric, same-element top-10% stress case,
  actual fee/prize break-even and per-race/campaign EV are **not computed** by
  this preliminary ranking. The owner 50% Car 1v1 P(win) screening rule is
  distinct from the 50% race-gate occupancy cap and does not prove positive EV.
  The UI labels these steps unavailable until their existing approved method
  is connected and tested; it does not silently fabricate output.

## Fail-closed boundary

The application service rejects mismatched owners, unsupported repository
states, duplicate tournament/split records, inconsistent ID-to-label mappings,
version drift, non-canonical timestamps, future imports, future cutoffs and
cutoffs that follow their accepted import. Freshness is derived at request time
from the accepted cutoff and server time, including the exact 3/4/7/8-day
boundaries; persisted labels are not trusted.

The default repository is unconfigured, so no provider initializes at module
import or build time. Tournament entry, automatic allocation, live-field claims,
Preview activation and Production activation remain unavailable.
