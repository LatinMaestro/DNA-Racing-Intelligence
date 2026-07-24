import { describe, expect, it } from "vitest";
import {
  buildFamilyTreeProjection,
  type FamilyTreeCore,
} from "@/domain/family-tree";

const family: readonly FamilyTreeCore[] = [
  {
    coreId: "g1",
    displayName: "Genesis One",
    coreClass: "Genesis",
    parentCoreIds: [],
  },
  {
    coreId: "g2",
    displayName: "Genesis Two",
    coreClass: "Genesis",
    parentCoreIds: [],
  },
  {
    coreId: "g3",
    displayName: "Genesis Three",
    coreClass: "Genesis",
    parentCoreIds: [],
  },
  {
    coreId: "g4",
    displayName: "Genesis Four",
    coreClass: "Genesis",
    parentCoreIds: [],
  },
  {
    coreId: "parent-a",
    displayName: "Parent A",
    coreClass: "Morphed",
    parentCoreIds: ["g1", "g2"],
  },
  {
    coreId: "parent-b",
    displayName: "Parent B",
    coreClass: "Morphed",
    parentCoreIds: ["g3", "g4"],
  },
  {
    coreId: "root",
    displayName: "Root",
    coreClass: "Freak",
    parentCoreIds: ["parent-a", "parent-b"],
  },
  {
    coreId: "full-sibling",
    displayName: "Full Sibling",
    coreClass: "Freak",
    parentCoreIds: ["parent-b", "parent-a"],
  },
  {
    coreId: "half-sibling",
    displayName: "Half Sibling",
    coreClass: "Freak",
    parentCoreIds: ["parent-a", "g3"],
  },
  {
    coreId: "child",
    displayName: "Child",
    coreClass: "X-Class",
    parentCoreIds: ["root", "g4"],
  },
  {
    coreId: "grandchild",
    displayName: "Grandchild",
    coreClass: "X-Class",
    parentCoreIds: ["child", "g3"],
  },
];

describe("family tree projection", () => {
  it("projects ancestors, siblings and descendants without changing confirmed restrictions", () => {
    const projection = buildFamilyTreeProjection(family, "root");

    expect(projection.status).toBe("ready");
    expect(projection.issues).toEqual([]);
    expect(
      projection.nodes.find((node) => node.coreId === "parent-a"),
    ).toMatchObject({
      relationships: ["parent"],
      ancestorDepth: 1,
    });
    expect(projection.nodes.find((node) => node.coreId === "g1")).toMatchObject(
      {
        relationships: ["grandparent"],
        ancestorDepth: 2,
      },
    );
    expect(
      projection.nodes.find((node) => node.coreId === "full-sibling"),
    ).toMatchObject({
      relationships: ["full_sibling"],
    });
    expect(
      projection.nodes.find((node) => node.coreId === "half-sibling"),
    ).toMatchObject({
      relationships: ["half_sibling"],
    });
    expect(
      projection.nodes.find((node) => node.coreId === "grandchild"),
    ).toMatchObject({
      relationships: ["grandchild"],
      descendantDepth: 2,
    });
  });

  it("keeps missing parents as unresolved placeholders and exposes incomplete evidence", () => {
    const projection = buildFamilyTreeProjection(
      [
        {
          coreId: "incomplete-root",
          displayName: null,
          coreClass: "Morphed",
          parentCoreIds: ["known", "missing"],
        },
        {
          coreId: "known",
          displayName: null,
          coreClass: "Genesis",
          parentCoreIds: [],
        },
      ],
      "incomplete-root",
    );

    expect(projection.status).toBe("review_required");
    expect(
      projection.nodes.find((node) => node.coreId === "missing"),
    ).toMatchObject({
      isResolved: false,
      relationships: ["parent"],
    });
    expect(projection.issues).toContainEqual({
      code: "missing_parent_core",
      coreIds: ["incomplete-root", "missing"],
    });
  });

  it("fails visibly for duplicated, self-referential and cyclic lineage", () => {
    const projection = buildFamilyTreeProjection(
      [
        {
          coreId: "cycle-a",
          displayName: null,
          coreClass: "Morphed",
          parentCoreIds: ["cycle-b", "cycle-b"],
        },
        {
          coreId: "cycle-b",
          displayName: null,
          coreClass: "Morphed",
          parentCoreIds: ["cycle-a", "cycle-b"],
        },
      ],
      "cycle-a",
    );

    expect(projection.status).toBe("review_required");
    expect(projection.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "cycle",
        "duplicate_parent_reference",
        "self_parent",
      ]),
    );
  });

  it("is deterministic across input and parent ordering", () => {
    const expected = buildFamilyTreeProjection(family, "root");
    const reordered = [...family].reverse().map((core) => ({
      ...core,
      parentCoreIds: [...core.parentCoreIds].reverse(),
    }));

    expect(buildFamilyTreeProjection(reordered, "root")).toEqual(expected);
  });

  it("returns no graph and an explicit issue when the root is unknown", () => {
    expect(buildFamilyTreeProjection(family, "unknown")).toEqual({
      rootCoreId: "unknown",
      status: "review_required",
      nodes: [],
      edges: [],
      issues: [{ code: "root_not_found", coreIds: ["unknown"] }],
    });
  });

  it("does not contaminate a resolved projection with unrelated lineage issues", () => {
    const projection = buildFamilyTreeProjection(
      [
        ...family,
        {
          coreId: "unrelated-invalid",
          displayName: null,
          coreClass: "Morphed",
          parentCoreIds: ["unrelated-invalid"],
        },
      ],
      "root",
    );

    expect(projection.status).toBe("ready");
    expect(projection.issues).toEqual([]);
    expect(
      projection.nodes.some((node) => node.coreId === "unrelated-invalid"),
    ).toBe(false);
  });
});
