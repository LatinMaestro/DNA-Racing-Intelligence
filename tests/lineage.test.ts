import { describe, expect, it } from "vitest";
import { evaluateFamilyPair, type LineageCore } from "@/domain/lineage";

const cores: readonly LineageCore[] = [
  { coreId: "g1", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "g2", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "g3", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "g4", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "p1", coreClass: "Morphed", parentCoreIds: ["g1", "g2"] },
  { coreId: "p2", coreClass: "Morphed", parentCoreIds: ["g3", "g4"] },
  { coreId: "child", coreClass: "Freak", parentCoreIds: ["p1", "p2"] },
  { coreId: "full", coreClass: "Freak", parentCoreIds: ["p1", "p2"] },
  { coreId: "half", coreClass: "Freak", parentCoreIds: ["p1", "g3"] },
  {
    coreId: "grandchild",
    coreClass: "X-Class",
    parentCoreIds: ["child", "g4"],
  },
  {
    coreId: "great-grandchild",
    coreClass: "X-Class",
    parentCoreIds: ["grandchild", "g3"],
  },
];

describe("confirmed family restrictions", () => {
  it("prohibits a parent pair in either argument order", () => {
    expect(evaluateFamilyPair(cores, "child", "p1")).toMatchObject({
      status: "ineligible",
      relation: "parent",
    });
    expect(evaluateFamilyPair(cores, "p1", "child")).toMatchObject({
      status: "ineligible",
      relation: "parent",
    });
  });

  it("prohibits grandparents and full siblings", () => {
    expect(evaluateFamilyPair(cores, "grandchild", "p1")).toMatchObject({
      status: "ineligible",
      relation: "grandparent",
    });
    expect(evaluateFamilyPair(cores, "child", "full")).toEqual({
      status: "ineligible",
      relation: "full_sibling",
      evidenceCoreIds: ["p1", "p2"],
    });
  });

  it("preserves explicitly allowed half siblings and distant descendants", () => {
    expect(evaluateFamilyPair(cores, "child", "half")).toEqual({
      status: "eligible",
      relation: "half_sibling_allowed",
      evidenceCoreIds: ["p1"],
    });
    expect(evaluateFamilyPair(cores, "great-grandchild", "p1")).toMatchObject({
      status: "eligible",
      relation: "distant_descendant_allowed",
    });
  });

  it("requires review for incomplete, missing, duplicated or cyclic lineage", () => {
    const incomplete: LineageCore = {
      coreId: "incomplete",
      coreClass: "Morphed",
      parentCoreIds: ["g1"],
    };
    const cyclic: readonly LineageCore[] = [
      {
        coreId: "cycle-a",
        coreClass: "Morphed",
        parentCoreIds: ["cycle-b", "g1"],
      },
      {
        coreId: "cycle-b",
        coreClass: "Morphed",
        parentCoreIds: ["cycle-a", "g2"],
      },
      ...cores,
    ];

    expect(
      evaluateFamilyPair([...cores, incomplete], "incomplete", "g4"),
    ).toMatchObject({
      status: "review_required",
      relation: "incomplete_lineage",
    });
    expect(evaluateFamilyPair(cores, "child", "missing")).toMatchObject({
      status: "review_required",
      relation: "unknown_core",
    });
    expect(evaluateFamilyPair(cores, "child", "child")).toMatchObject({
      status: "review_required",
      relation: "same_core",
    });
    expect(evaluateFamilyPair(cyclic, "cycle-a", "g3")).toMatchObject({
      status: "review_required",
      relation: "invalid_lineage",
    });
  });
});
