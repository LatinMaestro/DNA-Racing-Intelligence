import { describe, expect, it } from "vitest";

import {
  allocateMaidenVaultOpportunities,
  type MaidenAllocationBracketInput,
  type MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";

const brackets: readonly MaidenAllocationBracketInput[] = [
  {
    tournamentId: "bike-maiden",
    bracketId: "bike-open",
    mode: "bike",
    reviewCapacity: 1,
    availability: "upcoming",
    ruleStatus: "confirmed",
  },
  {
    tournamentId: "car-maiden",
    bracketId: "car-open",
    mode: "car",
    reviewCapacity: 1,
    availability: "upcoming",
    ruleStatus: "confirmed",
  },
];

function candidate(
  candidateId: string,
  coreId: string,
  bracketId: "bike-open" | "car-open",
  value: number,
  overrides: Partial<MaidenAllocationCandidateInput> = {},
): MaidenAllocationCandidateInput {
  return {
    candidateId,
    coreId,
    tournamentId: bracketId === "bike-open" ? "bike-maiden" : "car-maiden",
    bracketId,
    mode: bracketId === "bike-open" ? "bike" : "car",
    projectedValueBasisPoints: value,
    suitability: "review_candidate",
    lifecycleState: "eligible",
    evidenceConfidence: "moderate",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

describe("Maiden vault opportunity allocation", () => {
  it("finds the maximum-value vault allocation rather than a local greedy choice", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("a-bike", "core-a", "bike-open", 9_000),
      candidate("a-car", "core-a", "car-open", 8_900),
      candidate("b-bike", "core-b", "bike-open", 8_800),
    ]);
    expect(
      result.assignments.map(({ candidateId }) => candidateId).sort(),
    ).toEqual(["a-car", "b-bike"]);
    expect(result.objective).toBe(
      "maximum_total_projected_value_with_one_me_per_core",
    );
  });

  it("allocates each core and each bracket only within configured capacity", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("a-bike", "core-a", "bike-open", 9_000),
      candidate("a-car", "core-a", "car-open", 8_000),
      candidate("b-bike", "core-b", "bike-open", 7_000),
      candidate("c-car", "core-c", "car-open", 6_000),
    ]);
    expect(new Set(result.assignments.map(({ coreId }) => coreId)).size).toBe(
      result.assignments.length,
    );
    expect(
      result.assignments.filter(({ bracketId }) => bracketId === "bike-open"),
    ).toHaveLength(1);
    expect(
      result.assignments.filter(({ bracketId }) => bracketId === "car-open"),
    ).toHaveLength(1);
  });

  it("excludes preserve-ME, held and unavailable entitlements", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("preserve", "core-a", "bike-open", 9_000, {
        suitability: "preserve_me",
      }),
      candidate("hold", "core-b", "bike-open", 8_000, {
        suitability: "hold",
      }),
      candidate("committed", "core-c", "car-open", 7_000, {
        lifecycleState: "committed",
      }),
    ]);
    expect(result.assignments).toEqual([]);
    expect(result.candidates.map(({ status }) => status)).toEqual([
      "entitlement_unavailable",
      "held",
      "preserve_me",
    ]);
    expect(result.warnings).toContain("PRESERVE_ME_PRESENT");
  });

  it("fails closed on stale, unknown-cutoff and uncertain bracket evidence", () => {
    const result = allocateMaidenVaultOpportunities(
      [brackets[0]!, { ...brackets[1]!, ruleStatus: "uncertain" }],
      [
        candidate("stale", "core-a", "bike-open", 9_000, {
          freshness: "stale",
        }),
        candidate("unknown", "core-b", "bike-open", 8_000, {
          dataCurrentThrough: null,
        }),
        candidate("uncertain", "core-c", "car-open", 7_000),
      ],
    );
    expect(result.assignments).toEqual([]);
    expect(result.candidates.map(({ status }) => status)).toEqual([
      "evidence_incomplete",
      "bracket_unavailable",
      "evidence_incomplete",
    ]);
    expect(result.warnings).toContain("STALE_OR_INCOMPLETE_EVIDENCE");
  });

  it("preserves legitimate score ties deterministically", () => {
    const result = allocateMaidenVaultOpportunities(
      [brackets[0]!],
      [
        candidate("candidate-a", "core-a", "bike-open", 8_000),
        candidate("candidate-b", "core-b", "bike-open", 8_000),
      ],
    );
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.candidateId).toBe("candidate-a");
    expect(
      result.candidates.find(({ candidateId }) => candidateId === "candidate-b")
        ?.status,
    ).toBe("capacity_unavailable");
  });

  it("never mutates an entitlement or authorises an entry", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("a-bike", "core-a", "bike-open", 9_000),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        entitlementMutationsPerformed: false,
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
        automaticEntryAllowed: false,
        liveFieldAvailable: false,
      }),
    );
  });

  it("requires exact bracket identity and unique core-bracket candidates", () => {
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad", "core-a", "bike-open", 9_000, {
          tournamentId: "wrong-tournament",
        }),
      ]),
    ).toThrow("exact configured tournament, bracket and mode");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad-mode", "core-a", "bike-open", 9_000, {
          mode: "car",
        }),
      ]),
    ).toThrow("exact configured tournament, bracket and mode");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("first", "core-a", "bike-open", 9_000),
        candidate("second", "core-a", "bike-open", 8_000),
      ]),
    ).toThrow("at most one candidate per bracket");
  });

  it("validates score and timestamp boundaries", () => {
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad", "core-a", "bike-open", 10_001),
      ]),
    ).toThrow("zero to 10,000");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad", "core-a", "bike-open", 9_000, {
          dataCurrentThrough: "2026-07-22T00:00:00Z",
          lastImported: "2026-07-21T00:00:00Z",
        }),
      ]),
    ).toThrow("Last imported cannot precede");
  });
});
