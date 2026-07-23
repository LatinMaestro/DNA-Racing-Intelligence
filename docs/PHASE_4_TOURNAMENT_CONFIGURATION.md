# Phase 4 Tournament Configuration Contract

This slice defines a deterministic, synthetic-only contract for owner-entered
tournament and qualification-bracket rules.

It supports variable mode, exact distances, gate count, exact entry fee and
asset, race format, class/element/F-number eligibility, leaderboard splits,
minimum race counts, fastest/median/average/points/wins/top-X/best-finish/custom
metrics, count or percentage qualification thresholds, and shared, separate or
unknown qualification race pools.

Uncertain rules, unknown race-pool semantics and custom rules remain
review-required. They cannot be passed silently into qualification evaluation.
Shared race pools require at least two explicitly linked brackets. Exact fees
and points use base-10 decimal strings.

This contract does not classify imported races, rank cores, recommend entries,
target gate occupancy or make any tournament output actionable. The 50% vault
gate limit remains a later cap check and is never a target.

Validation uses synthetic fixtures only. Production, provider state, private
data and the existing review gates remain unchanged.
