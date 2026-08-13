# Phase 4 Tournament Candidate Ranking Contract

This slice turns version-bound tournament configuration and historical candidate
evidence into a deterministic, non-actionable review order. Candidates are
compared only inside the same labelled leaderboard group. Equal configured
metric ranks remain ties; ranks are never recomputed across groups.

Every split records its tournament label, split label, qualification metric,
configuration version and candidate-snapshot version. Candidate evidence must
match both versions and use a consistent ID-to-label mapping. Inconsistent
bindings or labels fail closed.

For a single configured exact distance, persisted performance profiles can
compute `fastest_single_time`, `median_time` and `average_time` once the
configured minimum race count is met. Those values are ranked with competition
ranks inside each leaderboard group, so exact ties remain tied. Multiple-distance
time comparisons, insufficient samples, missing profiles and result-based or
custom metrics remain unranked and fail closed until matching qualifying-event
evidence exists.

Time-evidence authority uses the persisted population outcome benchmark for the
same mode and one exact configured distance. A candidate is `strong` when its
best time reaches the historical winning p75 or its median reaches the historical
winning median; it is `competitive` at the corresponding top-three boundaries
and `weak` outside them. Missing benchmarks, missing exact-distance profiles and
multiple-distance configurations remain unknown. Confidence is deliberately
capped at `medium` until calibration: a comparable profile below the configured
race minimum is low confidence, while missing direct evidence is unknown.

Eligibility, evidence completeness, primary time evidence, confidence,
server-derived freshness and Maiden opportunity cost can hold a candidate out
of review ordering. Historical Gold/Blue evidence is supporting rationale only.
It cannot improve a configured metric rank or override weak time evidence.

For one exact configured distance, persisted star profiles provide supporting
rationale from auditable Gold/Blue assignment-opportunity counts. Repeated
received stars support the time hypothesis; repeated zero-received evidence over
at least the configured race minimum conflicts with strong/competitive time
evidence, while repeated stars conflict with weak time evidence. Isolated
no-star evidence remains neutral. Missing, anomalous, ineligible or
multiple-distance evidence remains unavailable. Star support never changes the
configured metric rank, and any conflict holds the candidate for review.

Candidate snapshots bind the complete owner star-profile cache count and refresh
timestamp to the active aggregate-complete Race Merge version. Missing, stale or
mixed-refresh star aggregates therefore fail closed as snapshot-unbound.

A Maiden-eligible core reserved for a stronger credible mode is labelled
`preserve ME`, even when it ranks strongly in another split. Unresolved
cross-mode Maiden evidence also remains held for review.

Every result is an imported historical snapshot. It does not represent a current
qualifying field, cannot authorise automatic entry and remains experimental
until Gate C. Final Maiden entry recommendations separately require Gate D.

Validation uses synthetic fixtures only. No persistence, provider, private-data,
deployment or Production state is changed.
