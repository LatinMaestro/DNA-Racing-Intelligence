# Phase 4 Qualification Metric Evidence Contract

This slice translates accepted historical observations into the metric configured
for a qualification bracket. It supports fastest single time, median time,
average time, wins, Top-X finishes, best finish and exact points tables. Custom
metrics remain explicitly unavailable until separately implemented and tested.

Evidence remains separated by bracket, leaderboard group, mode and configured
exact distance. Time averages and medians use exact rational milliseconds;
points use exact base-10 decimal arithmetic. Incomplete samples, missing
time/finish evidence and imported-data freshness remain visible.

The resulting rank is experimental and historical only. It does not represent
the current qualifying field, does not use historical star rationale as the
leaderboard metric, does not allocate races, and cannot authorise Auto-Entry.
Gate C holdout, baseline and calibration evidence remains mandatory before an
actionable qualification recommendation.

Validation uses synthetic fixtures only. No persistence, provider, private-data,
deployment or Production state is changed.
