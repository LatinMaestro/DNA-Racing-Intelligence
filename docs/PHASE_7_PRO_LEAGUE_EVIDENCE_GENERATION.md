# Phase 7 Pro League evidence generation

Migration `0084` is the private publication boundary for the exact Bike
race-type-plus-distance benchmarks and Core profiles produced from the complete
Race archive.

- Each generation is owner-scoped and bound to an exact active Race dataset
  version, source-version-set digest and point-in-time evidence cutoff.
- Benchmark and profile rows are staged in bounded, replay-safe batches. The
  database derives every row digest from the stored JSONB value.
- Publication verifies exact per-family counts, contiguous ordinals and a
  deterministic two-family digest before one transaction updates the active
  pointer. A partial or stale generation remains invisible and cannot replace
  last-good evidence.
- Published rows and their generation receipt are immutable. Private reads can
  access only the active generation through bounded, ordered functions; the
  runtime role has no direct table privileges.
- The service consumes the single-use spillable producer without retaining the
  complete benchmark/profile result in memory and always cleans its R2 scratch
  runs. A retry may replay already staged ordinals only when their natural key,
  payload and database-derived digest match exactly.

This boundary stores compact analytical evidence, not raw API responses. It
does not deploy or publish the website, initiate a game action, or alter the
P5 immutable R2 archive.
