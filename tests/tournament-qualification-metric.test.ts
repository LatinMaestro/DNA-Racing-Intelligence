import { describe, expect, it } from "vitest";

import {
  projectTournamentQualificationMetrics,
  type TournamentMetricCandidate,
  type TournamentMetricProfile,
} from "@/domain/tournament-qualification-metric";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

const candidates: readonly TournamentMetricCandidate[] = [
  { coreId: "fire-a", leaderboardGroupId: "fire", eligibility: "eligible" },
  { coreId: "fire-b", leaderboardGroupId: "fire", eligibility: "eligible" },
  { coreId: "fire-c", leaderboardGroupId: "fire", eligibility: "eligible" },
  { coreId: "water-a", leaderboardGroupId: "water", eligibility: "eligible" },
];

function rule(
  rankingMetric: TournamentRuleConfiguration["qualification"]["rankingMetric"],
  distances: readonly number[] = [1_200],
): Pick<
  TournamentRuleConfiguration,
  "mode" | "eligibleDistancesMetres" | "qualification"
> {
  return {
    mode: "bike",
    eligibleDistancesMetres: distances,
    qualification: {
      minimumRaceCount: 10,
      target: { kind: "count", value: 5 },
      rankingMetric,
      topFinishPosition: null,
      pointsTable: {},
      customScoringConfiguration: {},
    },
  };
}

function profile(
  coreId: string,
  bestMilliseconds: number,
  overrides: Partial<TournamentMetricProfile> = {},
): TournamentMetricProfile {
  return {
    coreId,
    mode: "bike",
    distanceMetres: 1_200,
    raceCount: 10,
    bestMilliseconds,
    medianMilliseconds: bestMilliseconds + 1_000,
    meanMilliseconds: bestMilliseconds + 2_000,
    ...overrides,
  };
}

describe("Tournament qualification metric projection", () => {
  it("ranks complete fastest-time evidence inside each leaderboard group", () => {
    const result = projectTournamentQualificationMetrics(
      rule("fastest_single_time"),
      candidates,
      [
        profile("fire-a", 60_000),
        profile("fire-b", 59_000),
        profile("fire-c", 59_000),
        profile("water-a", 61_000),
      ],
    );

    expect([...result]).toEqual([
      [
        "fire-a",
        {
          metricStatus: "complete",
          metricRank: 3,
          metricEvidenceLabel: "fastest_single_time",
        },
      ],
      [
        "fire-b",
        {
          metricStatus: "complete",
          metricRank: 1,
          metricEvidenceLabel: "fastest_single_time",
        },
      ],
      [
        "fire-c",
        {
          metricStatus: "complete",
          metricRank: 1,
          metricEvidenceLabel: "fastest_single_time",
        },
      ],
      [
        "water-a",
        {
          metricStatus: "complete",
          metricRank: 1,
          metricEvidenceLabel: "fastest_single_time",
        },
      ],
    ]);
  });

  it("uses median and average time only when the minimum sample is met", () => {
    const median = projectTournamentQualificationMetrics(
      rule("median_time"),
      candidates.slice(0, 2),
      [
        profile("fire-a", 59_000, { medianMilliseconds: 62_000 }),
        profile("fire-b", 60_000, {
          raceCount: 9,
          medianMilliseconds: 61_000,
        }),
      ],
    );
    expect(median.get("fire-a")).toEqual({
      metricStatus: "complete",
      metricRank: 1,
      metricEvidenceLabel: "median_time",
    });
    expect(median.get("fire-b")).toEqual({
      metricStatus: "partial",
      metricRank: null,
      metricEvidenceLabel: "median_time",
    });

    const average = projectTournamentQualificationMetrics(
      rule("average_time"),
      candidates.slice(0, 2),
      [
        profile("fire-a", 59_000, { meanMilliseconds: 63_000 }),
        profile("fire-b", 60_000, { meanMilliseconds: 62_000 }),
      ],
    );
    expect(average.get("fire-b")?.metricRank).toBe(1);
    expect(average.get("fire-a")?.metricRank).toBe(2);
  });

  it("fails closed for missing, ineligible and unsupported evidence", () => {
    const result = projectTournamentQualificationMetrics(
      rule("points"),
      [
        candidates[0]!,
        { ...candidates[1]!, eligibility: "ineligible" },
      ],
      [profile("fire-a", 60_000), profile("fire-b", 59_000)],
    );
    expect([...result.values()]).toEqual([
      {
        metricStatus: "unavailable",
        metricRank: null,
        metricEvidenceLabel: null,
      },
      {
        metricStatus: "unavailable",
        metricRank: null,
        metricEvidenceLabel: null,
      },
    ]);
  });

  it("does not compare time values across different exact distances", () => {
    const result = projectTournamentQualificationMetrics(
      rule("fastest_single_time", [1_200, 1_600]),
      candidates.slice(0, 2),
      [
        profile("fire-a", 60_000),
        profile("fire-b", 75_000, { distanceMetres: 1_600 }),
      ],
    );
    expect([...result.values()]).toEqual([
      {
        metricStatus: "partial",
        metricRank: null,
        metricEvidenceLabel: "fastest_single_time",
      },
      {
        metricStatus: "partial",
        metricRank: null,
        metricEvidenceLabel: "fastest_single_time",
      },
    ]);
  });

  it("rejects duplicated or invalid profile evidence", () => {
    expect(() =>
      projectTournamentQualificationMetrics(
        rule("fastest_single_time"),
        candidates.slice(0, 1),
        [profile("fire-a", 60_000), profile("fire-a", 60_000)],
      ),
    ).toThrow("duplicated");
    expect(() =>
      projectTournamentQualificationMetrics(
        rule("fastest_single_time"),
        candidates.slice(0, 1),
        [profile("fire-a", 0)],
      ),
    ).toThrow("best time is invalid");
  });
});
