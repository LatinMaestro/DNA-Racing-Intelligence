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

Eligibility, evidence completeness, primary time evidence, confidence,
server-derived freshness and Maiden opportunity cost can hold a candidate out
of review ordering. Historical Gold/Blue evidence is supporting rationale only.
It cannot improve a configured metric rank or override weak time evidence.

A Maiden-eligible core reserved for a stronger credible mode is labelled
`preserve ME`, even when it ranks strongly in another split. Unresolved
cross-mode Maiden evidence also remains held for review.

Every result is an imported historical snapshot. It does not represent a current
qualifying field, cannot authorise automatic entry and remains experimental
until Gate C. Final Maiden entry recommendations separately require Gate D.

Validation uses synthetic fixtures only. No persistence, provider, private-data,
deployment or Production state is changed.
