import { describe, expect, it } from "vitest";

import { buildProLeagueEsportsBenchmark } from "@/domain/pro-league-esports-benchmark";

const completedAt = "2026-09-23T06:03:45.027Z";

describe("Pro League Esports benchmark", () => {
  it("separates first-place and Madness positive-contributor time targets", () => {
    const benchmark = buildProLeagueEsportsBenchmark({
      races: [
        {
          matchId: "match-1",
          raceId: "race-wta",
          mapId: "anchor",
          raceNumber: 1,
          raceType: "1v1",
          distanceMetres: 1_000,
          gateCount: 2,
          scoring: "wta_win",
          homeTeamId: "home",
          awayTeamId: "away",
          pointTo: "away",
          homeCoreIds: ["1"],
          awayCoreIds: ["2"],
          completedAt,
        },
        {
          matchId: "match-1",
          raceId: "race-madness",
          mapId: "anchor",
          raceNumber: 2,
          raceType: "6_gate_madness",
          distanceMetres: 1_000,
          gateCount: 6,
          scoring: "podium_majority",
          homeTeamId: "home",
          awayTeamId: "away",
          pointTo: "home",
          homeCoreIds: ["1", "3", "5"],
          awayCoreIds: ["2", "4", "6"],
          completedAt,
        },
      ],
      results: [
        {
          raceId: "race-wta",
          coreId: "2",
          finishPosition: 1,
          elapsedTimeMilliseconds: 10_000,
        },
        {
          raceId: "race-wta",
          coreId: "1",
          finishPosition: 2,
          elapsedTimeMilliseconds: 10_500,
        },
        {
          raceId: "race-madness",
          coreId: "1",
          finishPosition: 1,
          elapsedTimeMilliseconds: 9_900,
        },
        {
          raceId: "race-madness",
          coreId: "2",
          finishPosition: 2,
          elapsedTimeMilliseconds: 10_050,
        },
        {
          raceId: "race-madness",
          coreId: "3",
          finishPosition: 3,
          elapsedTimeMilliseconds: 10_100,
        },
        {
          raceId: "race-madness",
          coreId: "4",
          finishPosition: 4,
          elapsedTimeMilliseconds: 10_200,
        },
        {
          raceId: "race-madness",
          coreId: "5",
          finishPosition: 5,
          elapsedTimeMilliseconds: 10_300,
        },
        {
          raceId: "race-madness",
          coreId: "6",
          finishPosition: 6,
          elapsedTimeMilliseconds: 10_400,
        },
      ],
    });

    expect(benchmark).toMatchObject({
      authority: "completed_official_esports_races",
      raceCount: 2,
      resultCount: 8,
      dataCurrentThrough: completedAt,
    });
    expect(benchmark.cells).toHaveLength(2);
    expect(benchmark.cells[0]).toMatchObject({
      scoring: "wta_win",
      positiveContributorTimes: {
        observationCount: 1,
        medianMilliseconds: 10_000,
      },
      podiumCutoffTimes: null,
    });
    expect(benchmark.cells[1]).toMatchObject({
      scoring: "podium_majority",
      firstPlaceTimes: { observationCount: 1, medianMilliseconds: 9_900 },
      positiveContributorTimes: {
        observationCount: 2,
        medianMilliseconds: 10_000,
      },
      podiumCutoffTimes: { observationCount: 1, medianMilliseconds: 10_100 },
    });
  });

  it("fails closed when WTA point authority conflicts with first place", () => {
    expect(() =>
      buildProLeagueEsportsBenchmark({
        races: [
          {
            matchId: "match-1",
            raceId: "race-1",
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
          {
            raceId: "race-1",
            coreId: "3",
            finishPosition: 1,
            elapsedTimeMilliseconds: 10_000,
          },
          {
            raceId: "race-1",
            coreId: "1",
            finishPosition: 2,
            elapsedTimeMilliseconds: 10_100,
          },
          {
            raceId: "race-1",
            coreId: "2",
            finishPosition: 3,
            elapsedTimeMilliseconds: 10_200,
          },
          {
            raceId: "race-1",
            coreId: "4",
            finishPosition: 4,
            elapsedTimeMilliseconds: 10_300,
          },
        ],
      }),
    ).toThrow("WTA point authority conflicts");
  });

  it("rejects incomplete or repeated declared entrant authority", () => {
    const race = {
      matchId: "match-1",
      raceId: "race-1",
      mapId: "anchor",
      raceNumber: 1,
      raceType: "4_gate_wta",
      distanceMetres: 1_200,
      gateCount: 4,
      scoring: "wta_win" as const,
      homeTeamId: "home",
      awayTeamId: "away",
      pointTo: "home" as const,
      homeCoreIds: ["1", "2"],
      awayCoreIds: ["3", "4"],
      completedAt,
    };
    for (const changed of [
      { ...race, homeCoreIds: ["1"] },
      { ...race, awayCoreIds: ["2", "4"] },
    ]) {
      expect(() =>
        buildProLeagueEsportsBenchmark({ races: [changed], results: [] }),
      ).toThrow("distinct entrants filling both halves");
    }
  });
});
