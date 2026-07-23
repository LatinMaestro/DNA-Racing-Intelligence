# Phase 6 Parent–Offspring Research

## Scope

This contract builds auditable parent–offspring research rows by exact mode and
distance. Parent time and star-profile features must predate breeding, offspring
outcomes must occur afterwards, and observations are divided into chronological
training and holdout partitions.

## Controls

- Parent IDs, offspring IDs and authoritative offspring event IDs remain
  explicit and unique.
- Parent feature cutoffs must be strictly earlier than breeding.
- Offspring outcomes must be strictly later than breeding.
- Bike, Car and Horse and different exact distances never merge.
- Fewer than ten parent races remain hypothesis-only.
- Gold and Blue numerators and denominators remain explicit and validated.
- Gold-ineligible events cannot carry a positive Gold assignment.
- Incomplete offspring star evidence is excluded rather than treated as false.
- Stale parent evidence and exact-cell mismatches are excluded with reasons.
- Chronological partitioning uses breeding time, not the later outcome.
- The dataset makes no inherited-star, predictive-lift, exceptional-offspring
  probability or pairing recommendation claim before Gate E.

## Deferred composition

Feature selection, time-only baseline comparison, calibrated exceptional-
offspring modelling, rankings, persistence, ledger integration, UI composition
and Gate E validation remain separate slices.
