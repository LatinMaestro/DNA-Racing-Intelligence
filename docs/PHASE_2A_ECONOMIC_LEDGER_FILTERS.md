# Phase 2A Economic Ledger Filter Contract

Date: 23 July 2026  
Status: unpublished repository domain contract with synthetic verification  
Production: disabled and fail-closed

## Purpose

This Phase 2A slice defines deterministic filters for the private economic
ledger without changing, aggregating or inventing transaction attribution.

Supported filter dimensions are:

- inclusive custom timeframe;
- original asset;
- category and subcategory;
- linked core;
- Bike, Car or Horse mode;
- exact distance in metres;
- sprint, middle or marathon distance band;
- tournament;
- bracket; and
- included/excluded reconciliation state.

Values within one dimension use OR. Different dimensions use AND.

## Original evidence

Every returned record retains its:

- transaction ID;
- normalized UTC timestamp;
- exact signed decimal;
- original asset;
- aggregate status;
- category and subcategory;
- core links;
- mode and exact metre distance; and
- tournament and bracket links.

The contract does not use the obsolete race-class field.

## Attribution boundary

A vault-level tournament payout may have no linked core. It remains visible
when no core filter is selected and contributes to the unallocated count.

Applying a core filter excludes that unallocated record. The filter never
assigns the payout to a core merely to complete a core report.

Tournament and bracket remain independent dimensions. Filtering either does not
collapse or infer the other.

## Distance treatment

Exact distance uses owner-confirmed metres.

Distance bands retain the approved inclusive ranges:

- sprint: 900–1400;
- middle: 1400–1800; and
- marathon: 1800–2200.

The confirmed ranges overlap at 1400 and 1800. The filter preserves this
literally: 1400 can match sprint or middle, and 1800 can match middle or
marathon. It does not invent a single exclusive boundary assignment.

## Reconciliation state

Excluded or confirmed-duplicate evidence is omitted by default. It is returned
only when `includeExcluded` is explicitly true, and the result states how many
excluded records matched.

No filter action changes reconciliation state.

## Fail-closed validation

The contract rejects:

- duplicate transaction IDs;
- unsupported runtime mode, band or aggregate-state values;
- invalid timestamps or inverted periods;
- malformed, zero or exponential decimal values;
- invalid assets;
- non-positive or duplicate exact-distance filters;
- duplicate values within any filter dimension; and
- invalid optional linked record fields.

## Boundaries

This slice does not:

- persist private records;
- sum or convert currencies;
- classify tournament stages;
- infer core, bracket or campaign attribution;
- describe imported history as live;
- initiate wallet or game transactions; or
- change Preview, Production, providers or GitHub Actions.

Database queries, saved filters, stage attribution, campaign aggregation and the
private dashboard remain later focused Phase 2A slices.

## Synthetic validation

Tests cover inclusive periods, deterministic ordering, asset separation,
multi-dimensional filtering, exact distance, overlapping band boundaries,
vault-level payout treatment, tournament/bracket separation, explicit excluded
evidence and fail-closed runtime inputs.
