# Phase 1 Lineage Graph and Family Validation

## Scope

This slice turns accepted Core Details parent edges into an owner-scoped lineage graph and a conservative family-pair decision. It uses only the confirmed restrictions in `GAME_RULES.md`.

## Confirmed pair rules

A pair is ineligible when the two cores are:

- parent and child;
- grandparent and grandchild; or
- full siblings sharing both parents.

Half siblings and relationships beyond grandparent remain eligible. Cousins and other relationships are not silently added to the prohibited set. A same-core request is an input error requiring review, not a newly invented family rule.

## Durable graph

Migration `0006_lineage_graph` adds:

- `core_lineage_reachability`, an owner-scoped transitive graph with `parent`, `grandparent` and `distant` generation bands;
- `core_lineage_validation_issue`, retaining cycles, Genesis-with-parent anomalies, missing class and non-Genesis parent-count problems;
- `refresh_core_lineage`, a serialized, deterministic owner refresh; and
- `evaluate_family_pair`, which returns `eligible`, `ineligible` or `review_required` with a stable relation code and evidence IDs.

The graph excludes cyclic self-reachability. A cycle affecting either evaluated core fails closed as `invalid_lineage`. Incomplete lineage fails closed after the function has checked any already-proven prohibited relationship. Refresh replaces only the current owner's derived graph and can be replayed without duplicating records.

## Privacy and access

All durable records use source-resolved UUIDs rather than names. Both tables have forced row-level security. Public table access and function execution are revoked. This migration is repository-only and does not create provider accounts, upload private Core Details data or enable Production.

## Synthetic verification

The TypeScript contract and PostgreSQL smoke test cover:

- parent and grandparent restrictions in either pairing direction;
- full-sibling rejection;
- explicit half-sibling and distant-descendant allowance;
- incomplete, missing, same-core and cyclic review states;
- deterministic refresh replay;
- removal on migration rollback; and
- forced owner isolation and revoked public execution.

The synthetic family contains no real core IDs, names or derived owner data.
