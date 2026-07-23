import { describe, expect, it } from "vitest";

import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
  type BreedingRankingCandidateInput,
} from "../domain/breeding-pair-ranking";

function candidate(
  pairId: string,
  parentCoreIds: readonly [string, string],
  overrides: Partial<BreedingRankingCandidateInput> = {},
): BreedingRankingCandidateInput {
  return {
    pairId,
    parentCoreIds,
    source: "owned_owned",
    mode: "Car",
    exactDistanceM: 1000,
    ruleStatus: "eligible",
    availabilityStatus: "confirmed",
    evidenceConfidence: "high",
    distributionStatus: "supported",
    usesStarFeatures: true,
    starLiftStatus: "supported",
    exceptionalUpsideBasisPoints: 1000,
    strongerOrExceptionalBasisPoints: 4000,
    vaultFitBasisPoints: 5000,
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingPairRankingInput> = {},
): BreedingPairRankingInput {
  return {
    rankingId: "ranking-1",
    evaluatedAt: "2026-07-23T06:00:00Z",
    dataCurrentThrough: "2026-07-21T00:00:00Z",
    lastImported: "2026-07-22T00:00:00Z",
    freshness: "current",
    eliteWeightBasisPoints: 6000,
    vaultFitWeightBasisPoints: 4000,
    candidates: [
      candidate("elite", ["a", "b"], {
        exceptionalUpsideBasisPoints: 2500,
        strongerOrExceptionalBasisPoints: 6500,
        vaultFitBasisPoints: 1000,
      }),
      candidate("gap", ["c", "d"], {
        exceptionalUpsideBasisPoints: 500,
        strongerOrExceptionalBasisPoints: 3500,
        vaultFitBasisPoints: 9500,
      }),
      candidate("balanced", ["e", "f"], {
        exceptionalUpsideBasisPoints: 1200,
        strongerOrExceptionalBasisPoints: 6000,
        vaultFitBasisPoints: 6000,
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
    expect(result.eliteRankingUsesVaultFit).toBe(false);
    expect(result.vaultSaturationCanSuppressEliteUpside).toBe(false);
    expect(result.rankingsRemainSeparate).toBe(true);
  });

  it("does not let vault saturation demote exceptional upside", () => {
    const result = rankBreedingPairs(
      input({
        candidates: [
          candidate("rare", ["a", "b"], {
            exceptionalUpsideBasisPoints: 3000,
            strongerOrExceptionalBasisPoints: 5000,
            vaultFitBasisPoints: 0,
          }),
          candidate("diverse", ["c", "d"], {
            exceptionalUpsideBasisPoints: 1000,
            strongerOrExceptionalBasisPoints: 9000,
            vaultFitBasisPoints: 10_000,
          }),
        ],
      }),
    );
    expect(result.eliteUpsideRanking[0]?.pairId).toBe("rare");
    expect(result.vaultGapRanking[0]?.pairId).toBe("diverse");
  });

  it("keeps balanced arithmetic exact as an integer numerator", () => {
    const result = rankBreedingPairs(
      input({
        eliteWeightBasisPoints: 5001,
        vaultFitWeightBasisPoints: 4999,
        candidates: [candidate("only", ["a", "b"])],
      }),
    );
    expect(result.balancedRanking[0]).toEqual(
      expect.objectContaining({
        balancedScoreNumerator: 44_999_000,
        balancedScoreDenominator: 10_000,
      }),
    );
  });

  it("holds stale evidence, unavailable external parents and unsupported models", () => {
    const stale = rankBreedingPairs(input({ freshness: "stale" }));
    expect(stale.eliteUpsideRanking).toHaveLength(0);
    expect(stale.heldPairs).toHaveLength(3);

    const held = rankBreedingPairs(
      input({
        candidates: [
          candidate("external", ["a", "b"], {
            source: "owned_arena",
            availabilityStatus: "expired",
          }),
          candidate("model", ["c", "d"], {
            distributionStatus: "uncalibrated",
          }),
        ],
      }),
    );
    expect(held.heldPairs[0]?.reasons[0]).toContain("availability");
    expect(held.heldPairs[1]?.reasons[0]).toContain("distribution");
  });

  it("requires supported lift only when star features are used", () => {
    const held = rankBreedingPairs(
      input({
        candidates: [
          candidate("star", ["a", "b"], {
            starLiftStatus: "not_supported",
          }),
          candidate("time", ["c", "d"], {
            usesStarFeatures: false,
            starLiftStatus: "not_evaluated",
          }),
        ],
      }),
    );
    expect(held.heldPairs.map(({ pairId }) => pairId)).toEqual(["star"]);
    expect(held.eliteUpsideRanking[0]?.pairId).toBe("time");
  });

  it("never authorises a recommendation or breeding execution", () => {
    const result = rankBreedingPairs(input());
    expect(result.recommendationAllowed).toBe(false);
    expect(result.breedingExecutionAllowed).toBe(false);
    expect(result.gateEPassed).toBe(false);
  });

  it("rejects duplicate pair identity regardless of parent order", () => {
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("one", ["a", "b"]),
            candidate("two", ["b", "a"]),
          ],
        }),
      ),
    ).toThrow("same parent pair");
  });

  it("validates probabilities, attributes and balanced weights", () => {
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("bad", ["a", "b"], {
              exceptionalUpsideBasisPoints: 5000,
              strongerOrExceptionalBasisPoints: 4000,
            }),
          ],
        }),
      ),
    ).toThrow("cannot exceed");
    expect(() =>
      rankBreedingPairs(input({ vaultFitWeightBasisPoints: 3999 })),
    ).toThrow("total 10000");
    expect(() =>
      rankBreedingPairs(
        input({
          candidates: [
            candidate("bad", ["a", "b"], {
              mode: "Jet" as BreedingRankingCandidateInput["mode"],
            }),
          ],
        }),
      ),
    ).toThrow("mode is invalid");
  });

  it("keeps imported and evaluation timestamps sequential", () => {
    expect(() =>
      rankBreedingPairs(input({ lastImported: "2026-07-20T00:00:00Z" })),
    ).toThrow("cannot precede data current through");
    expect(() =>
      rankBreedingPairs(input({ evaluatedAt: "2026-07-21T00:00:00Z" })),
    ).toThrow("cannot predate the imported evidence");
  });
});
