import { describe, expect, it } from "vitest";
import type { CorePerformanceProfile } from "@/domain/core-performance";
import {
  buildDistanceBandProjection,
  distanceBandMemberships,
} from "@/domain/distance-band-performance";
import type { CoreStarProfile } from "@/domain/star-signals";

function starProfile(
  distance: number,
  overrides: Partial<CoreStarProfile> = {},
): CoreStarProfile {
  return {
    coreId: "core-a",
    mode: "bike",
    distance,
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    raceCount: 10,
    completeStarDataRaceCount: 8,
    partialStarDataRaceCount: 1,
    missingStarDataRaceCount: 1,
    invalidStarDataRaceCount: 0,
    goldEligibleRaceCount: 8,
    goldAssignmentOpportunityCount: 5,
    goldReceivedCount: 2,
    goldNegativeOpportunityCount: 3,
    goldEligibleNoAssignmentCount: 2,
    goldIneligibleAssignmentCount: 0,
    goldExcludedAnomalyCount: 1,
    goldReceivedRate: { numerator: 2, denominator: 5 },
    blueAssignmentOpportunityCount: 4,
    blueReceivedCount: 1,
    blueNegativeOpportunityCount: 3,
    blueNoAssignmentCount: 4,
    blueExcludedAnomalyCount: 2,
    blueReceivedRate: { numerator: 1, denominator: 4 },
    sameCoreReceivedBothCount: 1,
    ...overrides,
  };
}

function profile(
  distance: number,
  overrides: Partial<CorePerformanceProfile> = {},
): CorePerformanceProfile {
  return {
    coreId: "core-a",
    mode: "bike",
    distance,
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    freshness: "current",
    raceCount: 10,
    sampleStatus: "minimally_analytical",
    elapsedTime: {
      bestMilliseconds: 50_000,
      medianMilliseconds: 55_000,
      meanMilliseconds: 55_000,
      trimmedMeanMilliseconds: 55_000,
      standardDeviationMilliseconds: 1_000,
      interquartileRangeMilliseconds: 2_000,
    },
    speed: {
      bestMetresPerSecond: 20,
      medianMetresPerSecond: 18,
    },
    starProfile: starProfile(distance),
    analyticalStatus: "experimental",
    ...overrides,
  };
}

describe("Phase 2 distance-band projection", () => {
  it("preserves the confirmed inclusive boundary definitions", () => {
    expect(distanceBandMemberships(900)).toEqual(["sprint"]);
    expect(distanceBandMemberships(1_399)).toEqual(["sprint"]);
    expect(distanceBandMemberships(1_400)).toEqual(["sprint", "middle"]);
    expect(distanceBandMemberships(1_800)).toEqual(["middle", "marathon"]);
    expect(distanceBandMemberships(2_200)).toEqual(["marathon"]);
    expect(distanceBandMemberships(800)).toEqual([]);
  });

  it("keeps core and mode evidence separate", () => {
    const projection = buildDistanceBandProjection([
      profile(1_000),
      profile(1_200, { coreId: "core-b", starProfile: null }),
      profile(1_000, { mode: "car", starProfile: null }),
    ]);

    expect(
      projection.summaries.map(({ coreId, mode, band }) => ({
        coreId,
        mode,
        band,
      })),
    ).toEqual([
      { coreId: "core-a", mode: "bike", band: "sprint" },
      { coreId: "core-a", mode: "car", band: "sprint" },
      { coreId: "core-b", mode: "bike", band: "sprint" },
    ]);
  });

  it("shows shared boundary evidence in both applicable bands", () => {
    const projection = buildDistanceBandProjection([profile(1_400)]);

    expect(projection.summaries).toHaveLength(2);
    expect(
      projection.summaries.map(
        ({ band, exactDistancesMetres, sharedBoundaryProfileCount }) => ({
          band,
          exactDistancesMetres,
          sharedBoundaryProfileCount,
        }),
      ),
    ).toEqual([
      {
        band: "sprint",
        exactDistancesMetres: [1_400],
        sharedBoundaryProfileCount: 1,
      },
      {
        band: "middle",
        exactDistancesMetres: [1_400],
        sharedBoundaryProfileCount: 1,
      },
    ]);
  });

  it("adds star counts and denominators instead of averaging rates", () => {
    const [summary] = buildDistanceBandProjection([
      profile(1_000),
      profile(1_200, {
        starProfile: starProfile(1_200, {
          goldAssignmentOpportunityCount: 3,
          goldReceivedCount: 3,
          goldReceivedRate: { numerator: 3, denominator: 3 },
          blueAssignmentOpportunityCount: 6,
          blueReceivedCount: 2,
          blueReceivedRate: { numerator: 2, denominator: 6 },
        }),
      }),
    ]).summaries;

    expect(summary?.starEvidence).toMatchObject({
      goldReceivedRate: { numerator: 5, denominator: 8 },
      blueReceivedRate: { numerator: 3, denominator: 10 },
      exactDistanceProfileCountWithStarData: 2,
      exactDistanceProfileCountWithoutStarData: 0,
    });
  });

  it("keeps elapsed time exact-distance specific and summarizes comparable speed", () => {
    const [summary] = buildDistanceBandProjection([
      profile(1_000, {
        speed: {
          bestMetresPerSecond: 21,
          medianMetresPerSecond: 19,
        },
      }),
      profile(1_200, {
        speed: {
          bestMetresPerSecond: 23,
          medianMetresPerSecond: 17,
        },
      }),
    ]).summaries;

    expect(summary).toMatchObject({
      exactDistancesMetres: [1_000, 1_200],
      elapsedTimeTreatment: "kept_separate_by_exact_distance",
      speedEvidence: {
        bestMetresPerSecondAcrossExactDistances: 23,
        slowestExactDistanceMedianMetresPerSecond: 17,
        fastestExactDistanceMedianMetresPerSecond: 19,
      },
      analyticalStatus: "experimental",
    });
  });

  it("uses conservative freshness and retains missing-star coverage", () => {
    const [summary] = buildDistanceBandProjection([
      profile(1_000, {
        dataCurrentThrough: "2026-07-20T00:00:00Z",
        freshness: "current",
      }),
      profile(1_200, {
        dataCurrentThrough: "2026-07-10T00:00:00Z",
        freshness: "stale",
        starProfile: null,
        raceCount: 4,
        sampleStatus: "hypothesis_only",
      }),
    ]).summaries;

    expect(summary).toMatchObject({
      dataCurrentThrough: "2026-07-20T00:00:00Z",
      oldestProfileCurrentThrough: "2026-07-10T00:00:00Z",
      freshness: "stale",
      profileFreshnessStates: ["current", "stale"],
      minimallyAnalyticalExactDistanceCount: 1,
      hypothesisOnlyExactDistanceCount: 1,
      starEvidence: {
        exactDistanceProfileCountWithStarData: 1,
        exactDistanceProfileCountWithoutStarData: 1,
      },
    });
  });

  it("retains outside-band warnings and rejects duplicate or mismatched evidence", () => {
    const projection = buildDistanceBandProjection([profile(800)]);
    expect(projection.summaries).toEqual([]);
    expect(projection.unbandedProfiles).toEqual([
      {
        coreId: "core-a",
        mode: "bike",
        distanceMetres: 800,
        warningCode: "OUTSIDE_SUPPORTED_DISTANCE_BANDS",
      },
    ]);

    expect(() =>
      buildDistanceBandProjection([profile(1_000), profile(1_000)]),
    ).toThrow("Duplicate exact-distance profile");

    expect(() =>
      buildDistanceBandProjection([
        profile(1_000, {
          starProfile: starProfile(1_200),
        }),
      ]),
    ).toThrow("Mismatched star profile");
  });

  it("fails closed on unsupported runtime states and contradictory star rates", () => {
    expect(() =>
      buildDistanceBandProjection([
        profile(1_000, {
          mode: "plane" as CorePerformanceProfile["mode"],
        }),
      ]),
    ).toThrow("Invalid exact-distance profile");

    expect(() =>
      buildDistanceBandProjection([
        profile(1_000, {
          freshness: "live" as CorePerformanceProfile["freshness"],
        }),
      ]),
    ).toThrow("Invalid exact-distance profile");

    expect(() =>
      buildDistanceBandProjection([
        profile(1_000, {
          starProfile: starProfile(1_000, {
            goldReceivedRate: { numerator: 9, denominator: 9 },
          }),
        }),
      ]),
    ).toThrow("Invalid star evidence");
  });

  it("is deterministic across input order", () => {
    const profiles = [
      profile(1_200),
      profile(1_000),
      profile(1_800, {
        mode: "horse",
        starProfile: starProfile(1_800, { mode: "horse" }),
      }),
    ];
    expect(buildDistanceBandProjection(profiles)).toEqual(
      buildDistanceBandProjection([...profiles].reverse()),
    );
  });
});
