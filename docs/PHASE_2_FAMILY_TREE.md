# Phase 2 Family Tree Projection

## Scope

This slice creates the deterministic read model required by the Phase 2 family
tree explorer. It projects accepted Core Details identity and parent edges for one
authoritative root core without changing the Phase 1 lineage graph or expanding
the confirmed breeding restrictions.

## Projection contract

`buildFamilyTreeProjection` exposes:

- the selected root;
- parents, grandparents and more distant known ancestors;
- children, grandchildren and more distant known descendants;
- full siblings where both source parent IDs match;
- half siblings where exactly one of two source parent IDs matches;
- sibling candidates where incomplete parentage prevents a reliable full/half
  classification;
- deterministic parent-child edges;
- unresolved parent IDs as visible placeholder nodes; and
- stable issue codes for missing, duplicate, incomplete, self-referential or
  cyclic lineage.

One core can hold more than one projected relationship where pedigree collapse
or a lineage cycle produces overlapping evidence. A cycle is never rewritten or
silently removed. It makes the selected projection review-required.

## Evidence and isolation

Source IDs remain authoritative. Display names are optional labels and are never
used to create or resolve an identity. A missing parent record remains unresolved
rather than being matched by name.

Only issues connected to the selected projection affect its status. An unrelated
malformed core elsewhere in the owner’s Core Details history does not contaminate
a resolved tree. Input and parent order do not affect the output.

This projection describes relationships only. It does not:

- decide breeding eligibility;
- add restrictions beyond parent, grandparent and full sibling;
- infer current ownership or breeding availability;
- infer hidden inherited qualities;
- expose private data publicly; or
- enable Production or a hosted import.

The existing `evaluateFamilyPair` contract remains the authority for confirmed
pair eligibility.

## Validation

Synthetic tests cover:

- root, parent and grandparent projection;
- child and grandchild projection;
- full- and half-sibling classification;
- unresolved parent placeholders;
- incomplete, duplicate, self-parent and cyclic warnings;
- isolation from unrelated lineage errors;
- unknown-root handling; and
- deterministic output across input and parent ordering.

Focused hosted-workspace validation passes repository-pinned Prettier, strict
TypeScript and all six synthetic tests. Mandatory full exact-head GitHub CI and
merge remain deferred while hosted runners are unavailable.
