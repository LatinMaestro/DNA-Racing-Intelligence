# Phase 7 Vault Role and Depth Analysis

## Purpose

Measure genuine Vault coverage, gaps and depth without treating duplicated roles
as an automatic sell or burn signal.

## Contract

- Keep Bike, Car and Horse plus exact distances separate.
- Count only supported roles above the configured credible-strength threshold as
  depth.
- Preserve review-required evidence outside confirmed depth.
- Identify unique, single-depth and duplicated roles for each active core.
- Require the configured number of credible alternatives before raising a
  redundancy review.
- Protect Maiden-reserve, lineage-anchor, unresolved and exceptional-upside
  roles regardless of apparent saturation.

## Boundaries

Role depth is one strategic input only. Duplicate coverage does not prove that a
core should be sold or burned, and this contract cannot issue or execute a
lifecycle recommendation.
