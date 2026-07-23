# Phase 2 Core Performance Contract

Date: 23 July 2026  
Status: repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Scope

This first Phase 2 slice defines the deterministic boundary between accepted,
normalized race observations and the future private core-profile experience.

It does not normalize the legacy source elapsed-time string, query private data,
claim predictive success or enable an actionable recommendation. The contract
accepts elapsed time only after an upstream validator has established a positive
integer millisecond value.

## Profile key

Every profile is keyed by:

- authoritative source core ID;
- one mode: Bike, Car or Horse; and
- exact race distance.

Evidence from different modes or exact distances is never merged. Broader
distance-band and lineage evidence may later support an explanation but cannot
replace the exact-distance profile.

## Accepted observations

Each accepted observation requires:

- a non-empty event ID and core ID;
- a valid event timestamp;
- a supported mode;
- a positive integer distance; and
- a positive safe-integer elapsed time in validated milliseconds.

A repeated event/core pair fails closed. Source-row quarantine and provenance
remain upstream Phase 1 responsibilities.

## Transparent statistics

For each profile, the contract calculates:

- race count;
- best, median, arithmetic mean and 10%-trimmed mean elapsed time;
- population standard deviation;
- interquartile range using linearly interpolated quartiles;
- best and median speed in metres per second, derived from exact distance and
  elapsed time; and
- the latest included event timestamp and freshness state.

Elapsed-time direction remains lower-is-better. Derived speed direction remains
higher-is-better. Race distance is owner-confirmed in metres. Analytical metrics
use JavaScript numbers only after monetary
and token accounting has been separated; exact ETH, DEZ, USD and BGC values
remain in the exact-value ledger.

## Evidence boundary

Fewer than 10 races for a core, mode and exact distance is labelled
`hypothesis_only`. Ten or more is labelled `minimally_analytical`; it is not
proof of quality or model dependability.

All Phase 2 profiles remain `experimental` until Gate C chronological holdout,
baseline and calibration evidence is complete. No synthetic result can satisfy
that gate.

## Star evidence

A performance profile may link only the precomputed Gold/Blue profile with the
same core ID, mode and exact distance. The linked object retains:

- Gold-eligible race count;
- Gold and Blue received numerators;
- assignment-opportunity denominators;
- anomaly and missing-data counts; and
- its own data-current-through timestamp.

Star evidence remains supporting evidence. It does not replace direct time and
speed, merge with a different mode/distance or become a standalone lifecycle
decision.

## Freshness and wording

The profile exposes its historical `Data current through` value and a
current/ageing/stale/unknown state. Future UI work must display import completion
separately and must not describe a profile as live.

## Core Intelligence workspace

The private Core Intelligence route now has an accessible historical-snapshot
presentation contract.

- With no accepted normalized performance profiles, it renders an explicit
  no-data state and no numerical substitute.
- A profile card exposes authoritative core ID, mode, exact distance, race count,
  best and median time, best speed in metres per second, sample status,
  Gold/Blue received counts and assignment-opportunity denominators.
- Data current-through, last-imported, freshness and experimental status remain
  visible and distinct.
- The workspace does not call imported evidence live, enable a recommendation or
  claim that 10 races proves core quality.

The route remains on the repository-safe empty state until private Preview
storage and a validated elapsed-time normalization pipeline are connected.

## Validation

Synthetic tests cover:

- strict Bike/Car/Horse and exact-distance separation;
- elapsed-time and derived-speed direction;
- the 10-race boundary;
- transparent distribution statistics;
- exact star-profile matching and denominators;
- stale historical coverage;
- deterministic input ordering; and
- rejection of invalid or duplicate accepted observations.
