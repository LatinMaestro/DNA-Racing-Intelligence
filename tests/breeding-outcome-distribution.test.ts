import { describe, expect, it } from "vitest";

import {
  buildBreedingOutcomeDistribution,
  type BreedingOutcomeDistributionInput,
} from "../domain/breeding-outcome-distribution";

function input(
  overrides: Partial<BreedingOutcomeDistributionInput> = {},
): BreedingOutcomeDistributionInput {
  return {
    analysisId: "analysis-1",
    pairId: "pair-1",
    parentCoreIds: ["parent-a", "parent-b"],
    mode: "Car",
    exactDistanceM: 1000,
    modelVersion: "research-v1",
    predictionAsOf: "2026-07-10T00:00:00Z",
    expectedBreedingAt: "2026-07-11T00:00:00Z",
    dataCurrentThrough: "2026-07-08T00:00:00Z",
    lastImported: "2026-07-09T00:00:00Z",
    freshness: "current",
    calibrationStatus: "supported",
    holdoutSampleCount: 100,
    minimumHoldoutSampleCount: 50,
    usesStarFeatures: true,
    starLiftStatus: "supported",
    estimates: {
      weaker: {
        probabilityBasisPoints: 2000,
        lowerBasisPoints: 1500,
        upperBasisPoints: 2500,
      },
      comparable: {
        probabilityBasisPoints: 4000,
        lowerBasisPoints: 3400,
        upperBasisPoints: 4600,
      },
      stronger: {
        probabilityBasisPoints: 3000,
        lowerBasisPoints: 2400,
        upperBasisPoints: 3600,
      },
      exceptional: {
        probabilityBasisPoints: 1000,
        lowerBasisPoints: 600,
        upperBasisPoints: 1500,
      },
    },
    ...overrides,
  };
}

describe("breeding outcome distribution", () => {
  it("preserves exact category probabilities and the exceptional tail", () => {
    const result = buildBreedingOutcomeDistribution(input());
    expect(result.distributionStatus).toBe("experimental_supported");
    expect(
      result.distribution.map(
        ({ probabilityBasisPoints }) => probabilityBasisPoints,
      ),
    ).toEqual([2000, 4000, 3000, 1000]);
    expect(result.exceptionalTail).toEqual({
      probabilityBasisPoints: 1000,
      lowerBasisPoints: 600,
      upperBasisPoints: 1500,
    });
    expect(result.probabilitiesAreDeterministicInheritance).toBe(false);
    expect(result.calibratedProbabilityClaimAllowed).toBe(false);
    expect(result.rankingAllowed).toBe(false);
    expect(result.recommendationAllowed).toBe(false);
    expect(result.gateEPassed).toBe(false);
  });

  it("holds a distribution when chronological sample is insufficient", () => {
    const result = buildBreedingOutcomeDistribution(
      input({ holdoutSampleCount: 49 }),
    );
    expect(result.distributionStatus).toBe("held_for_sample");
    expect(result.holdReasons[0]).toContain("below the configured minimum");
  });

  it("holds unsupported calibration evidence", () => {
    const result = buildBreedingOutcomeDistribution(
      input({ calibrationStatus: "not_supported" }),
    );
    expect(result.distributionStatus).toBe("held_for_calibration");
  });

  it("requires incremental lift before using star features", () => {
    const result = buildBreedingOutcomeDistribution(
      input({ starLiftStatus: "not_supported" }),
    );
    expect(result.distributionStatus).toBe("held_for_star_lift");
    expect(result.holdReasons.at(-1)).toContain("incremental holdout lift");
  });

  it("does not require star lift for a time-only distribution", () => {
    const result = buildBreedingOutcomeDistribution(
      input({
        usesStarFeatures: false,
        starLiftStatus: "not_evaluated",
      }),
    );
    expect(result.distributionStatus).toBe("experimental_supported");
  });

  it("gives stale evidence the highest-priority hold", () => {
    const result = buildBreedingOutcomeDistribution(
      input({
        freshness: "stale",
        holdoutSampleCount: 10,
        calibrationStatus: "insufficient",
      }),
    );
    expect(result.distributionStatus).toBe("held_for_freshness");
    expect(result.holdReasons).toHaveLength(3);
  });

  it("requires probabilities to total exactly 10000 basis points", () => {
    expect(() =>
      buildBreedingOutcomeDistribution(
        input({
          estimates: {
            ...input().estimates,
            exceptional: {
              probabilityBasisPoints: 999,
              lowerBasisPoints: 600,
              upperBasisPoints: 1500,
            },
          },
        }),
      ),
    ).toThrow("exactly 10000");
  });

  it("requires every estimate to sit within its uncertainty interval", () => {
    expect(() =>
      buildBreedingOutcomeDistribution(
        input({
          estimates: {
            ...input().estimates,
            stronger: {
              probabilityBasisPoints: 3000,
              lowerBasisPoints: 3100,
              upperBasisPoints: 3600,
            },
          },
        }),
      ),
    ).toThrow("within its uncertainty interval");
  });

  it("keeps imported cutoff and prediction timestamps sequential", () => {
    expect(() =>
      buildBreedingOutcomeDistribution(
        input({ predictionAsOf: "2026-07-08T12:00:00Z" }),
      ),
    ).toThrow("cannot precede the imported evidence");
    expect(() =>
      buildBreedingOutcomeDistribution(
        input({ expectedBreedingAt: "2026-07-09T00:00:00Z" }),
      ),
    ).toThrow("cannot predate the prediction");
  });

  it("rejects duplicate parent identity and invalid basis points", () => {
    expect(() =>
      buildBreedingOutcomeDistribution(
        input({ parentCoreIds: ["parent-a", "parent-a"] }),
      ),
    ).toThrow("distinct parents");
    expect(() =>
      buildBreedingOutcomeDistribution(
        input({
          estimates: {
            ...input().estimates,
            exceptional: {
              probabilityBasisPoints: 10_001,
              lowerBasisPoints: 600,
              upperBasisPoints: 10_000,
            },
          },
        }),
      ),
    ).toThrow("0 to 10000");
  });
});
