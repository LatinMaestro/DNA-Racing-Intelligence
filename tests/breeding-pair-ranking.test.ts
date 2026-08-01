import { describe, expect, it } from "vitest";

import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
  type BreedingRankingCandidateInput,
} from "@/domain/breeding-pair-ranking";

const versions = {
  rulesetVersion: "rules-2026-07-07",
  candidateSnapshotVersion: "candidates-v9",
  projectionVersion: "offspring-v4",
} as const;

function parent(coreId: string, ownership: "owned" | "arena" = "owned") {
  return {
    coreId,
    ownership,
    coreClass: coreId.endsWith("a")
      ? ("Genesis" as const)
      : ("Morphed" as const),
    element: coreId.endsWith("a") ? ("Metal" as const) : ("Earth" as const),
    fNumber: coreId.endsWith("a") ? 3 : 8,
  };
}

function candidate(
  pairId: string,
  parentCoreIds: readonly [string, string],
  overrides: Partial<BreedingRankingCandidateInput> = {},
): BreedingRankingCandidateInput {
  const parents = [parent(parentCoreIds[0]), parent(parentCoreIds[1])] as const;
  return {
    pairId,
    parents,
    source: "owned_owned",
    mode: "Car",
    exactDistanceM: 1_000,
    ...versions,
    arenaSnapshotVersion: null,
    ruleStatus: "eligible",
    familyStatus: "eligible",
    sexCompatibilityStatus: "compatible",
    cycleStatus: "available",
    spliceCapacityStatus: "available",
    availabilityStatus: "confirmed",
    arenaListingExpiresAt: null,
    evidenceConfidence: "high",
    distributionStatus: "supported",
    chronologicalValidationStatus: "supported",
    usesStarFeatures: true,
    starLiftStatus: "supported",
    exceptionalUpsideBasisPoints: 1_000,
    strongerOrExceptionalBasisPoints: 4_000,
    vaultFitBasisPoints: 5_000,
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingPairRankingInput> = {},
): BreedingPairRankingInput {
  return {
    rankingId: "ranking-1",
    rankingLabel: "Synthetic Car 1,000 m",
    ...versions,
    arenaSnapshotVersion: "arena-v5",
    evaluatedAt: "2026-07-23T06:00:00.000Z",
    dataCurrentThrough: "2026-07-21T00:00:00.000Z",
    lastImported: "2026-07-22T00:00:00.000Z",
    freshness: "current",
    arenaDataCurrentThrough: "2026-07-21T00:00:00.000Z",
    arenaLastImported: "2026-07-22T00:00:00.000Z",
    arenaFreshness: "current",
    eliteWeightBasisPoints: 6_000,
    vaultFitWeightBasisPoints: 4_000,
    candidates: [
      candidate("elite", ["elite-a", "elite-b"], {
        exceptionalUpsideBasisPoints: 2_500,
        strongerOrExceptionalBasisPoints: 6_500,
        vaultFitBasisPoints: 1_000,
      }),
      candidate("gap", ["gap-a", "gap-b"], {
        exceptionalUpsideBasisPoints: 500,
        strongerOrExceptionalBasisPoints: 3_500,
        vaultFitBasisPoints: 9_500,
      }),
      candidate("balanced", ["balanced-a", "balanced-b"], {
        exceptionalUpsideBasisPoints: 1_200,
        strongerOrExceptionalBasisPoints: 6_000,
        vaultFitBasisPoints: 6_000,
      }),
    ],
    ...overrides,
  };
}

describe("breeding pair ranking", () => {
  it("publishes three genuinely separate ranking views", () => {
    const result = rankBreedingPairs(input());
    expect(result.eliteUpsideRanking.map(({ pairId }) => pairId)).toEqual([
      "elite",
      "balanced",
      "gap",
    ]);
    expect(result.vaultGapRanking.map(({ pairId }) => pairId)).toEqual([
      "gap",
      "balanced",
      "elite",
    ]);
    expect(result.balancedRanking.map(({ pairId }) => pairId)).toEqual([
      "balanced",
      "gap",
      "elite",
    ]);
    expect(result).toMatchObject({
      eliteRankingUsesVaultFit: false,
      vaultSaturationCanSuppressEliteUpside: false,
      rankingsRemainSeparate: true,
    });
  });

  it("does not let Vault saturation demote exceptional upside", () => {
    const result = rankBreedingPairs(
      input({
        candidates: [
          candidate("rare", ["rare-a", "rare-b"], {
            exceptionalUpsideBasisPoints: 3_000,
            strongerOrExceptionalBasisPoints: 5_000,
            vaultFitBasisPoints: 0,
          }),
          candidate("diverse", ["diverse-a", "diverse-b"], {
            exceptionalUpsideBasisPoints: 1_000,
            strongerOrExceptionalBasisPoints: 9_000,
            vaultFitBasisPoints: 10_000,
          }),
        ],
      }),
    );
    expect(result.eliteUpsideRanking[0]?.pairId).toBe("rare");
    expect(result.vaultGapRanking[0]?.pairId).toBe("diverse");
  });

  it("derives confirmed offspring class, lower element and uncapped F-number", () => {
    const result = rankBreedingPairs(
      input({ candidates: [candidate("only", ["core-a", "core-b"])] }),
    );
    expect(result.eliteUpsideRanking[0]).toMatchObject({
      predictedOffspringClass: "Freak",
      predictedOffspringElement: "Earth",
      predictedOffspringFNumber: 11,
    });
  });

  it("keeps balanced arithmetic exact as an integer numerator", () => {
    const result = rankBreedingPairs(
      input({
        eliteWeightBasisPoints: 5_001,
        vaultFitWeightBasisPoints: 4_999,
        candidates: [candidate("only", ["only-a", "only-b"])],
      }),
    );
    expect(result.balancedRanking[0]).toEqual(
      expect.objectContaining({
        balancedScoreNumerator: 44_999_000,
        balancedScoreDenominator: 10_000,
      }),
    );
  });

  it("holds stale evidence and every unresolved breeding-rule boundary", () => {
    const stale = rankBreedingPairs(input({ freshness: "stale" }));
    expect(stale.eliteUpsideRanking).toHaveLength(0);
    expect(stale.heldPairs).toHaveLength(3);

    for (const overrides of [
      { familyStatus: "review_required" as const },
      { sexCompatibilityStatus: "unknown" as const },
      { cycleStatus: "unknown" as const },
      { spliceCapacityStatus: "unknown" as const },
      { availabilityStatus: "marked_unavailable" as const },
      { distributionStatus: "uncalibrated" as const },
      { chronologicalValidationStatus: "insufficient" as const },
    ]) {
      const held = rankBreedingPairs(
        input({
          candidates: [candidate("held", ["held-a", "held-b"], overrides)],
        }),
      );
      expect(held.heldPairs).toHaveLength(1);
      expect(held.eliteUpsideRanking).toEqual([]);
    }
  });

  it("requires current accepted Arena evidence and unexpired external listings", () => {
    const external = candidate("external", ["external-a", "external-b"], {
      parents: [parent("external-a"), parent("external-b", "arena")],
      source: "owned_arena",
      arenaSnapshotVersion: "arena-v5",
      arenaListingExpiresAt: "2026-07-30T00:00:00.000Z",
    });
    expect(
      rankBreedingPairs(input({ candidates: [external] })).eliteUpsideRanking,
    ).toHaveLength(1);
    for (const overrides of [
      { arenaFreshness: "stale" as const },
      { arenaDataCurrentThrough: null },
      { arenaLastImported: null },
    ]) {
      expect(
        rankBreedingPairs(input({ candidates: [external], ...overrides }))
          .heldPairs,
      ).toHaveLength(1);
    }
    expect(
      rankBreedingPairs(
        input({
          candidates: [
            { ...external, arenaListingExpiresAt: "2026-07-23T06:00:00.000Z" },
          ],
        }),
      ).heldPairs[0]?.reasons,
    ).toContain("External-parent listing was expired at evaluation.");
  });

  it("requires supported incremental lift only when star features are used", () => {
    const held = rankBreedingPairs(
      input({
        candidates: [
          candidate("star", ["star-a", "star-b"], {
            starLiftStatus: "not_supported",
          }),
          candidate("time", ["time-a", "time-b"], {
            usesStarFeatures: false,
            starLiftStatus: "not_evaluated",
          }),
        ],
      }),
    );
    expect(held.heldPairs.map(({ pairId }) => pairId)).toEqual(["star"]);
    expect(held.eliteUpsideRanking[0]?.pairId).toBe("time");
  });

  it("binds rules, candidates, projections and Arena snapshots exactly", () => {
    for (const overrides of [
      { rulesetVersion: "rules-old" },
      { candidateSnapshotVersion: "candidates-old" },
      { projectionVersion: "projection-old" },
    ]) {
      expect(() =>
        rankBreedingPairs(
          input({
            candidates: [candidate("drift", ["drift-a", "drift-b"], overrides)],
          }),
        ),
      ).toThrow("exact active versions");
    }
  });

  it("rejects source and ownership mismatches", () => {
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("bad", ["bad-a", "bad-b"], {
              parents: [parent("bad-a"), parent("bad-b", "arena")],
            }),
          ],
        }),
      ),
    ).toThrow("match parent ownership");
  });

  it("never treats listings as live or economic evidence", () => {
    const result = rankBreedingPairs(input());
    expect(result).toMatchObject({
      importedHistoricalEvidence: true,
      arenaListingsAreLive: false,
      arenaListingsCreateTransactions: false,
      recommendationAllowed: false,
      breedingExecutionAllowed: false,
      gateEPassed: false,
    });
  });

  it("rejects duplicate pair identity regardless of parent order", () => {
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("one", ["same-a", "same-b"]),
            candidate("two", ["same-b", "same-a"]),
          ],
        }),
      ),
    ).toThrow("same parent pair");
  });

  it("validates estimates, attributes and balanced weights", () => {
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("bad", ["bad-a", "bad-b"], {
              exceptionalUpsideBasisPoints: 5_000,
              strongerOrExceptionalBasisPoints: 4_000,
            }),
          ],
        }),
      ),
    ).toThrow("cannot exceed");
    expect(() =>
      rankBreedingPairs(input({ vaultFitWeightBasisPoints: 3_999 })),
    ).toThrow("total 10,000");
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("bad", ["bad-a", "bad-b"], {
              mode: "Jet" as BreedingRankingCandidateInput["mode"],
            }),
          ],
        }),
      ),
    ).toThrow("mode is invalid");
  });

  it("requires canonical sequential timestamps", () => {
    expect(() =>
      rankBreedingPairs(input({ lastImported: "2026-07-20T00:00:00.000Z" })),
    ).toThrow("cannot precede data current through");
    expect(() =>
      rankBreedingPairs(input({ evaluatedAt: "2026-07-21T00:00:00.000Z" })),
    ).toThrow("cannot predate accepted import evidence");
    expect(() =>
      rankBreedingPairs(input({ evaluatedAt: "2026-07-23T06:00:00Z" })),
    ).toThrow("canonical timestamp");
  });
});
