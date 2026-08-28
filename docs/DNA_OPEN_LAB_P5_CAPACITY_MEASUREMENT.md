# DNA Open Lab P5 API-only capacity measurement

## Authority

This contract measures only the API-first current-state path. It does not use or
require the retired CSV ingestion path. A report is bound to one exact code head,
one complete acquisition-plan checksum, one provider scope, one measurement
evidence reference and one observation time.

It cannot authorise persistent owner-data sync, Production, deployment, paid
capacity or any DNA transaction.

## PostgreSQL 18 evidence

Measure the protected private Preview path on PostgreSQL 18 and record:

- the existing database baseline;
- settled database size after a complete synthetic full cycle;
- the maximum sampled database size while staging and atomic publication overlap;
- owner-scoped heap, index and TOAST bytes after settlement; and
- at least two physical-size samples so a single settled reading cannot be
  presented as transient-peak evidence.

The approved boundary remains `536870912` bytes. Peak—not settled size—is used
for headroom. Zero headroom is blocking.

## Private R2 evidence and cost

Record retained object count, payload bytes, metadata bytes, projected monthly
Class A and Class B operations, and a dated provider-price authority. Prices are
inputs expressed as integer micro-USD; the repository deliberately does not
hard-code time-sensitive provider pricing. Price authority may be at most 31
days old. Cost arithmetic rounds each billed component upward and remains
reproducible. Empty footprint or operation observations fail closed.

## Safety and gate interpretation

- Local synthetic evidence exercises the contract but cannot satisfy connected
  P5 evidence.
- A protected private Preview report may update only the three capacity rows in
  the P5 readiness matrix after complete review.
- Positive capacity evidence still cannot authorise the first persistent sync;
  connected recovery evidence and explicit owner approval remain separate.
- Every bounded provider test must use synthetic data, write no persistent real
  owner data, include no raw payload or secret material, and leave zero residue.

## Current state

The measurement contract is implemented, but no connected measurement has been
performed. PostgreSQL physical/peak storage, private R2 footprint/cost and
positive Neon headroom therefore remain pending P5 evidence.
