# Phase 4 Tournament Entry Allocation Contract

This slice creates a deterministic, review-only initial qualification plan from
explicit candidate requests and planned races. It allocates only the requested
probe count; spare capacity remains deliberately unfilled.

For each planned race, owned entries are capped at the whole-number floor of 50%
of configured gates. The cap is a hard maximum, never an allocation target.
Existing planned owned entries count toward that cap, and the same core cannot be
placed twice in one race.

Held, ineligible and `preserve ME` candidates receive no suggested allocation.
Requests that exceed planned capacity remain visible and unallocated rather than
forcing additional entries or weakening the cap.

Imported data cannot confirm live occupancy. Every planned race therefore
requires user confirmation against the current field, and the contract cannot
perform an automatic game action. Gate C remains mandatory before the plan can
be presented as actionable.

Validation uses synthetic fixtures only. No persistence, provider, private-data,
deployment or Production state is changed.
