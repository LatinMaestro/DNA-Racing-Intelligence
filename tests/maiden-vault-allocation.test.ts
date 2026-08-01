import { describe, expect, it } from "vitest";

import {
  allocateMaidenVaultOpportunities,
  type MaidenAllocationBracketInput,
  type MaidenAllocationCandidateInput,
} from "@/domain/maiden-vault-allocation";

const versions = {
  configurationVersion: "config-v3",
  candidateSnapshotVersion: "snapshot-v9",
  projectionVersion: "projection-v4",
} as const;

const brackets: readonly MaidenAllocationBracketInput[] = [
  {
    tournamentId: "bike-maiden",
    tournamentLabel: "Bike Maiden",
    bracketId: "bike-open",
    bracketLabel: "Bike Open",
    mode: "bike",
    ...versions,
    reviewCapacity: 1,
    availability: "upcoming",
    ruleStatus: "confirmed",
  },
  {
    tournamentId: "car-maiden",
    tournamentLabel: "Car Maiden",
    bracketId: "car-open",
    bracketLabel: "Car Open",
    mode: "car",
    ...versions,
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
    ...versions,
    projectionBasis: "time_led_chronological",
    projectedValueBasisPoints: value,
    suitability: "review_candidate",
    lifecycleState: "eligible",
    evidenceConfidence: "moderate",
    timeEvidence: "competitive",
    historicalStarSupport: "neutral",
    crossModeEvidenceComplete: true,
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    lastImported: "2026-07-21T00:00:00.000Z",
    freshness: "current",
    ...overrides,
  };
}

describe("Maiden vault opportunity allocation", () => {
  it("finds the strongest whole-vault allocation rather than a local greedy choice", () => {
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

  it("excludes preserve-ME, held and unavailable lifecycle states", () => {
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

  it("fails closed on stale, incomplete, weak-time and uncertain evidence", () => {
    const result = allocateMaidenVaultOpportunities(
      [brackets[0]!, { ...brackets[1]!, ruleStatus: "uncertain" }],
      [
        candidate("stale", "core-a", "bike-open", 9_000, {
          freshness: "stale",
        }),
        candidate("unknown", "core-b", "bike-open", 8_000, {
          dataCurrentThrough: null,
        }),
        candidate("weak-time", "core-d", "bike-open", 7_500, {
          timeEvidence: "weak",
          historicalStarSupport: "supports",
        }),
        candidate("uncertain", "core-c", "car-open", 7_000),
      ],
    );
    expect(result.assignments).toEqual([]);
    expect(result.candidates.map(({ status }) => status)).toEqual([
      "evidence_incomplete",
      "bracket_unavailable",
      "evidence_incomplete",
      "evidence_incomplete",
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "STALE_OR_INCOMPLETE_EVIDENCE",
        "WEAK_OR_UNKNOWN_TIME_EVIDENCE",
      ]),
    );
  });

  it("requires complete cross-mode evidence before allocation", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("partial", "core-a", "bike-open", 9_000, {
        crossModeEvidenceComplete: false,
      }),
    ]);
    expect(result.assignments).toEqual([]);
    expect(result.candidates[0]?.status).toBe("evidence_incomplete");
    expect(result.warnings).toContain("CROSS_MODE_EVIDENCE_INCOMPLETE");
  });

  it("binds labels and every evidence version while ignoring stars for allocation", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("star-conflict", "core-a", "bike-open", 8_000, {
        historicalStarSupport: "conflicts",
      }),
    ]);
    expect(result.assignments[0]).toMatchObject({
      tournamentLabel: "Bike Maiden",
      bracketLabel: "Bike Open",
      ...versions,
    });
    expect(result.candidates[0]).toMatchObject({
      historicalStarSupport: "conflicts",
      starUsedForAllocation: false,
    });

    for (const overrides of [
      { configurationVersion: "config-v2" },
      { candidateSnapshotVersion: "snapshot-v8" },
      { projectionVersion: "projection-v3" },
    ]) {
      expect(() =>
        allocateMaidenVaultOpportunities(brackets, [
          candidate("wrong-version", "core-a", "bike-open", 8_000, overrides),
        ]),
      ).toThrow("exact configured tournament, bracket, mode and versions");
    }
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

  it("never mutates an entitlement or authorises a recommendation or entry", () => {
    const result = allocateMaidenVaultOpportunities(brackets, [
      candidate("a-bike", "core-a", "bike-open", 9_000),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        entitlementMutationsPerformed: false,
        importedHistoricalSnapshot: true,
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
        automaticEntryAllowed: false,
        liveFieldAvailable: false,
      }),
    );
    expect(result.warnings).toContain("HISTORICAL_ENTITLEMENT_UNPROVEN");
  });

  it("requires exact bracket identity and unique core-bracket candidates", () => {
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad", "core-a", "bike-open", 9_000, {
          tournamentId: "wrong-tournament",
        }),
      ]),
    ).toThrow("exact configured tournament, bracket, mode and versions");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad-mode", "core-a", "bike-open", 9_000, {
          mode: "car",
        }),
      ]),
    ).toThrow("exact configured tournament, bracket, mode and versions");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("first", "core-a", "bike-open", 9_000),
        candidate("second", "core-a", "bike-open", 8_000),
      ]),
    ).toThrow("at most one candidate per bracket");
  });

  it("rejects inconsistent labels, versions and cross-mode bindings", () => {
    expect(() =>
      allocateMaidenVaultOpportunities(
        [
          brackets[0]!,
          {
            ...brackets[0]!,
            bracketId: "bike-second",
            bracketLabel: "Bike Second",
            tournamentLabel: "Wrong Label",
          },
        ],
        [],
      ),
    ).toThrow("labels or versions are inconsistent");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bike", "core-a", "bike-open", 9_000),
        candidate("car", "core-a", "car-open", 8_000, {
          projectionVersion: "projection-v3",
        }),
      ]),
    ).toThrow();
  });

  it("validates value, projection basis and canonical chronology", () => {
    for (const value of [0, 10_001]) {
      expect(() =>
        allocateMaidenVaultOpportunities(brackets, [
          candidate("bad-value", "core-a", "bike-open", value),
        ]),
      ).toThrow("one to 10,000");
    }
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad-basis", "core-a", "bike-open", 9_000, {
          projectionBasis: "unsupported" as "time_led_chronological",
        }),
      ]),
    ).toThrow("projection basis");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad-time", "core-a", "bike-open", 9_000, {
          dataCurrentThrough: "2026-07-20T00:00:00Z",
        }),
      ]),
    ).toThrow("canonical timestamp");
    expect(() =>
      allocateMaidenVaultOpportunities(brackets, [
        candidate("bad-order", "core-a", "bike-open", 9_000, {
          dataCurrentThrough: "2026-07-22T00:00:00.000Z",
          lastImported: "2026-07-21T00:00:00.000Z",
        }),
      ]),
    ).toThrow("Last imported cannot precede");
  });
});
