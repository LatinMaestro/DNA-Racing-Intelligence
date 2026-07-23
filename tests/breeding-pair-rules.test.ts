import { describe, expect, it } from "vitest";

import {
  evaluateBreedingPairRules,
  type BreedingPairRuleInput,
  type BreedingParentRuleInput,
} from "@/domain/breeding-pair-rules";
import type { LineageCore } from "@/domain/lineage";

const lineage: readonly LineageCore[] = [
  { coreId: "g1", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "g2", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "g3", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "g4", coreClass: "Genesis", parentCoreIds: [] },
  { coreId: "a", coreClass: "Morphed", parentCoreIds: ["g1", "g2"] },
  { coreId: "b", coreClass: "Morphed", parentCoreIds: ["g3", "g4"] },
  { coreId: "child", coreClass: "Freak", parentCoreIds: ["a", "b"] },
];

function parent(
  coreId: "a" | "b" | "child",
  overrides: Partial<BreedingParentRuleInput> = {},
): BreedingParentRuleInput {
  const coreClass = coreId === "child" ? "Freak" : "Morphed";
  return {
    coreId,
    coreClass,
    element: coreId === "a" ? "Metal" : "Fire",
    fNumber: coreId === "a" ? 3 : 5,
    selectionStatus: "selected",
    availability: "available",
    spliceCapacityStatus: "available",
    remainingSplices: 2,
    cycleStatus: "ready",
    nextEligibleAt: null,
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingPairRuleInput> = {},
): BreedingPairRuleInput {
  return {
    parentA: parent("a"),
    parentB: parent("b"),
    lineage,
    evaluatedAt: "2026-07-23T00:00:00Z",
    ...overrides,
  };
}

describe("breeding pair rules", () => {
  it("combines confirmed family and parent-state rules", () => {
    const result = evaluateBreedingPairRules(input());
    expect(result).toEqual(
      expect.objectContaining({
        status: "rule_eligible",
        ruleEligible: true,
        offspring: {
          coreClass: "Freak",
          element: "Fire",
          fNumber: 8,
        },
        offspringQualityPredicted: false,
        historicalStarsUsedAsInheritedTrait: false,
        recommendationAllowed: false,
        breedingExecutionAllowed: false,
      }),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "GATE_E_NOT_PASSED",
        "STAR_INHERITANCE_NOT_ASSUMED",
      ]),
    );
  });

  it("fails a confirmed prohibited family pairing", () => {
    const result = evaluateBreedingPairRules(
      input({ parentA: parent("a"), parentB: parent("child") }),
    );
    expect(result.status).toBe("family_ineligible");
    expect(result.familyDecision.relation).toBe("parent");
    expect(result.warnings).toContain("FAMILY_INELIGIBLE");
  });

  it("holds incomplete or invalid lineage for review", () => {
    const result = evaluateBreedingPairRules(
      input({
        lineage: lineage.filter(({ coreId }) => coreId !== "g4"),
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.warnings).toContain("FAMILY_REVIEW_REQUIRED");
  });

  it("distinguishes exhausted capacity and a temporary breeding cooldown", () => {
    const exhausted = evaluateBreedingPairRules(
      input({
        parentA: parent("a", {
          spliceCapacityStatus: "exhausted",
          remainingSplices: 0,
        }),
      }),
    );
    expect(exhausted.status).toBe("temporarily_unavailable");
    expect(exhausted.warnings).toContain("SPLICE_CAPACITY_EXHAUSTED");

    const cooldown = evaluateBreedingPairRules(
      input({
        parentB: parent("b", {
          cycleStatus: "cooldown",
          nextEligibleAt: "2026-07-24T00:00:00Z",
        }),
      }),
    );
    expect(cooldown.status).toBe("temporarily_unavailable");
    expect(cooldown.warnings).toContain("BREEDING_CYCLE_COOLDOWN");
  });

  it("does not invent unknown splice capacity or cycle state", () => {
    const result = evaluateBreedingPairRules(
      input({
        parentA: parent("a", {
          spliceCapacityStatus: "unknown",
          remainingSplices: null,
          cycleStatus: "unknown",
        }),
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "SPLICE_CAPACITY_UNKNOWN",
        "BREEDING_CYCLE_UNKNOWN",
      ]),
    );
  });

  it("holds stale or missing imported evidence", () => {
    const result = evaluateBreedingPairRules(
      input({
        parentA: parent("a", {
          dataCurrentThrough: null,
          lastImported: null,
          freshness: "unknown",
        }),
      }),
    );
    expect(result.status).toBe("review_required");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["DATA_CUTOFF_UNKNOWN", "LAST_IMPORTED_UNKNOWN"]),
    );
  });

  it("validates splice status without assuming a global maximum", () => {
    expect(() =>
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", {
            spliceCapacityStatus: "available",
            remainingSplices: 0,
          }),
        }),
      ),
    ).toThrow("inconsistent");
    expect(
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", { remainingSplices: 99 }),
        }),
      ).parentStates[0]!.remainingSplices,
    ).toBe(99);
  });

  it("requires cooldown evidence to be future-facing and explicit", () => {
    expect(() =>
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", {
            cycleStatus: "cooldown",
            nextEligibleAt: null,
          }),
        }),
      ),
    ).toThrow("requires one next-eligible timestamp");
    expect(() =>
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", {
            cycleStatus: "cooldown",
            nextEligibleAt: "2026-07-22T00:00:00Z",
          }),
        }),
      ),
    ).toThrow("must follow evaluation");
  });

  it("requires selected parent class to match lineage evidence", () => {
    expect(() =>
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", { coreClass: "Genesis" }),
        }),
      ),
    ).toThrow("must match the selected lineage evidence");
  });

  it("rejects unsupported runtime attributes and an inexact F-number sum", () => {
    expect(() =>
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", {
            element: "Air" as BreedingParentRuleInput["element"],
          }),
        }),
      ),
    ).toThrow("Parent element is invalid");
    expect(() =>
      evaluateBreedingPairRules(
        input({
          parentA: parent("a", {
            fNumber: Number.MAX_SAFE_INTEGER,
          }),
          parentB: parent("b", { fNumber: 1 }),
        }),
      ),
    ).toThrow("must remain an exact safe integer");
  });
});
