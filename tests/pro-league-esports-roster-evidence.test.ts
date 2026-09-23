import { describe, expect, it } from "vitest";

import { buildProLeagueEsportsBenchmark } from "@/domain/pro-league-esports-benchmark";
import {
  applyOfficialEsportsBenchmark,
  hasOfficialEsportsBenchmark,
} from "@/domain/pro-league-esports-roster-evidence";
import type { ProLeagueExactFormatEvidence } from "@/domain/pro-league-matchup";

const completedAt = "2026-09-23T06:36:45.070Z";

function result(
  raceId: string,
  coreId: string,
  finishPosition: number,
  elapsedTimeMilliseconds: number,
) {
  return { raceId, coreId, finishPosition, elapsedTimeMilliseconds };
}

function evidence(): ProLeagueExactFormatEvidence {
  return {
    raceType: "1v1",
    distanceMetres: 1_000,
    raceCount: 12,
    sampleStatus: "minimally_analytical",
    freshness: "current",
    dataCurrentThrough: "2026-09-22T00:00:00.000Z",
    benchmarkAssessment: "outside_top_three_range",
    elapsedTime: {
      bestMilliseconds: 50_000,
      medianMilliseconds: 54_000,
      trimmedMeanMilliseconds: 56_000,
      standardDeviationMilliseconds: 900,
      interquartileRangeMilliseconds: 1_200,
    },
    speed: {
      bestMetresPerSecond: 20,
      medianMetresPerSecond: 18.519,
    },
    populationBenchmark: {
      dataCurrentThrough: "2026-09-22T00:00:00.000Z",
      raceEntryCount: 2,
      coreCount: 2,
      winningEntryCount: 1,
      topThreeEntryCount: 1,
      winningP25Milliseconds: 50_000,
      winningMedianMilliseconds: 50_000,
      winningP75Milliseconds: 50_000,
      winningStandardDeviationMilliseconds: 0,
      winningInterquartileRangeMilliseconds: 0,
      topThreeP25Milliseconds: 50_000,
      topThreeMedianMilliseconds: 50_000,
      topThreeP75Milliseconds: 50_000,
      topThreeStandardDeviationMilliseconds: 0,
      topThreeInterquartileRangeMilliseconds: 0,
    },
    supportingEvidence: {
      outcomes: { status: "available", winCount: 2, topThreeCount: 5 },
      goldStar: {
        status: "available",
        assignedCount: 1,
        eligibleRaceCount: 12,
      },
      blueStar: { status: "available", assignedCount: 1, opportunityCount: 12 },
      oppositionAdjustedStars: {
        status: "unavailable",
        qualityKnownRaceCount: 0,
        strongFieldYellowReceivedCount: 0,
        strongFieldBlueReceivedCount: 0,
        eliteOpponentYellowReceivedCount: 0,
        eliteOpponentBlueReceivedCount: 0,
        yellowFieldAdjustedIndex: null,
        blueFieldAdjustedIndex: null,
        rawConversionUsedForRanking: false,
      },
      strongOpposition: {
        status: "unavailable",
        raceCount: 0,
        winCount: 0,
        topThreeCount: 0,
      },
    },
  };
}

describe("official Esports roster evidence", () => {
  it("replaces historical population bands with exact official winning pace", () => {
    const races = ["a", "b"].map((suffix, index) => ({
      matchId: `match-${suffix}`,
      raceId: `race-${suffix}`,
      mapId: "anchor",
      raceNumber: index + 1,
      raceType: "1v1",
      distanceMetres: 1_000,
      gateCount: 2,
      scoring: "wta_win" as const,
      homeTeamId: `home-${suffix}`,
      awayTeamId: `away-${suffix}`,
      pointTo: "home" as const,
      homeCoreIds: [`home-core-${suffix}`],
      awayCoreIds: [`away-core-${suffix}`],
      completedAt,
    }));
    const benchmark = buildProLeagueEsportsBenchmark({
      races,
      results: [
        result("race-a", "home-core-a", 1, 50_000),
        result("race-a", "away-core-a", 2, 51_000),
        result("race-b", "home-core-b", 1, 60_000),
        result("race-b", "away-core-b", 2, 61_000),
      ],
    });

    const updated = applyOfficialEsportsBenchmark(evidence(), benchmark);

    expect(updated.benchmarkAssessment).toBe("winning_range");
    expect(updated.populationBenchmark).toMatchObject({
      dataCurrentThrough: completedAt,
      raceEntryCount: 4,
      coreCount: 4,
      winningEntryCount: 2,
      topThreeEntryCount: 2,
      winningP25Milliseconds: 52_500,
      winningMedianMilliseconds: 55_000,
      winningP75Milliseconds: 57_500,
      winningStandardDeviationMilliseconds: 5_000,
      winningInterquartileRangeMilliseconds: 5_000,
    });
  });

  it("fails closed when the official exact cell is absent", () => {
    const benchmark = buildProLeagueEsportsBenchmark({
      races: [
        {
          matchId: "match-a",
          raceId: "race-a",
          mapId: "glory",
          raceNumber: 1,
          raceType: "4_gate_wta",
          distanceMetres: 1_200,
          gateCount: 4,
          scoring: "wta_win",
          homeTeamId: "home",
          awayTeamId: "away",
          pointTo: "home",
          homeCoreIds: ["1", "2"],
          awayCoreIds: ["3", "4"],
          completedAt,
        },
      ],
      results: [
        result("race-a", "1", 1, 60_000),
        result("race-a", "2", 2, 60_100),
        result("race-a", "3", 3, 60_200),
        result("race-a", "4", 4, 60_300),
      ],
    });

    expect(() => applyOfficialEsportsBenchmark(evidence(), benchmark)).toThrow(
      "Exactly one official Esports benchmark is required",
    );
    expect(
      hasOfficialEsportsBenchmark({
        benchmark,
        raceType: evidence().raceType,
        distanceMetres: evidence().distanceMetres,
      }),
    ).toBe(false);
  });
});
