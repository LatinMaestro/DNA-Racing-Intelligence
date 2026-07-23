# Phase 4 Tournament Eligibility Contract

This slice evaluates a confirmed current-Vault core against one tournament
bracket’s class, element, F-number and Maiden rules. It also resolves explicit
leaderboard groups, including combined groups such as Metal + Fire and Earth +
Water.

The result is eligible, ineligible or review-required. Inactive ownership,
manual unavailability and confirmed rule mismatches are ineligible. Unresolved
identity or attributes, unknown Maiden or availability state, ambiguous or
missing leaderboard groups, and ageing/stale/unknown imported evidence remain
review-required.

The contract uses no race-performance or star evidence and cannot authorise an
entry. It preserves `Data current through`, `Last imported` and freshness
separately so imported ownership and attributes are never presented as live.

Validation uses synthetic fixtures only. It adds no persistence, UI,
classification, ranking, provider, private-data or Production change.
