# Phase 4 Tournament Path Guidance Contract

This slice produces a conservative, review-only signal for whether a
qualification probe should continue, pause, become a stop candidate or preserve
an uncommitted Maiden.

A stop candidate requires the configured minimum sample, consistently weak
qualification-metric evidence and weak time evidence. Eligible no-star evidence
is non-dispositive, and Gold-ineligible no-star evidence is explicitly excluded.
Neither can create a stop.

Strong-field historical stars may support a limited continuation before the
minimum sample is reached, but only when time is not weak. Time/metric
disagreement, unavailable evidence, stale data, low confidence, exhausted budget
or the configured probe limit pauses the path for review.

An uncommitted Maiden reserved for a stronger projected Bike, Car or Horse mode
is labelled `preserve ME`. Imported timestamps remain separate, and attempts
after the historical cutoff are rejected.

The signal is experimental and cannot authorise a live entry or automatic game
action before Gate C. Final Maiden recommendations separately require Gate D.

Validation uses synthetic fixtures only. No persistence, provider, private-data,
deployment or Production state is changed.
