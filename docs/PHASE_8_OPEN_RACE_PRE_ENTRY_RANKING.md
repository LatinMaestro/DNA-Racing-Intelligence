# Phase 8 Open Race Pre-entry Ranking

## Purpose

Compare confirmed eligible owned cores against the manually entered field while
the race is still forming.

## Contract

- Require matching mode and exact-distance profiles for every candidate and
  every resolved opponent.
- Rank candidates by lower historical median elapsed time.
- Preserve the minimum-10 boundary and hold a hypothesis-only leader.
- Treat historical Gold and Blue profiles as disclosed supporting rationale
  without allowing them to change the time rank.
- Preserve materially tied leaders rather than choosing by display order.
- Surface an avoid signal only when the best candidate's optimistic time remains
  slower than the strongest opponent's conservative time.
- Hold stale evidence, unresolved opponents and missing opponent histories.
- Disclose partial historical star coverage without allowing it to block or
  alter a sound time-led rank.

## Boundaries

The output is provisional and non-actionable before Gate C. The contract accepts
no current-race star input, cannot run after field lock, cannot recommend a
replacement core, enter a race or mutate source facts.
