# Phase 4 Tournament Candidate Ranking Contract

This slice turns bracket eligibility and configured qualification-metric evidence
into a deterministic review order. Candidates are compared only within the same
leaderboard group, and the configured metric rank remains the sole ordering
authority.

Eligibility, evidence completeness, time strength, confidence, freshness and
Maiden opportunity cost can hold a candidate out of the review order.
Historical Gold/Blue evidence is retained only as supporting rationale. It never
improves a configured metric rank and cannot override weak time evidence.

A Maiden-eligible core reserved for a stronger projected mode is labelled
`preserve ME`, even when it ranks strongly in the currently available bracket.
Unresolved cross-mode Maiden evidence also holds the candidate for review.

Every result remains an imported historical snapshot. It does not represent the
current qualifying field, cannot authorise Auto-Entry and is non-actionable until
Gate C. Final Maiden entry recommendations separately require Gate D.

Validation uses synthetic fixtures only. No persistence, provider, private-data,
deployment or Production state is changed.
