import { describe, expect, it } from "vitest";

import {
  loadProLeagueSeason1Week1Benchmark,
  proLeagueSeason1Week1Benchmark,
} from "@/domain/pro-league-esports-week1-authority";
import { proLeagueMaps } from "@/domain/pro-league-maps";

describe("official Season 1 Week 1 Esports authority", () => {
  it("loads and reconciles every safe exact-cell aggregate", () => {
    expect(proLeagueSeason1Week1Benchmark).toMatchObject({
      authority: "completed_official_esports_races",
      raceCount: 984,
      resultCount: 9_346,
      dataCurrentThrough: "2026-09-23T06:36:45.070Z",
    });
    expect(proLeagueSeason1Week1Benchmark.cells).toHaveLength(62);
    expect(
      proLeagueSeason1Week1Benchmark.cells.reduce(
        (sum, cell) => sum + cell.raceCount,
        0,
      ),
    ).toBe(984);
    expect(proLeagueSeason1Week1Benchmark.cells[0]).toMatchObject({
      raceType: "1v1",
      distanceMetres: 1_000,
      gateCount: 2,
      scoring: "wta_win",
      raceCount: 62,
      uniqueCoreCount: 43,
      targets: {
        eliteMilliseconds: 55_531,
        expectedWinningMilliseconds: 56_464.5,
        maximumPositiveMilliseconds: 57_011.75,
      },
    });

    const publishedMapCells = new Set(
      proLeagueMaps.flatMap((map) =>
        map.races.map((race) =>
          JSON.stringify([race.raceType.toLowerCase(), race.distanceMetres]),
        ),
      ),
    );
    const officialWeekOneCells = new Set(
      proLeagueSeason1Week1Benchmark.cells.map((cell) =>
        JSON.stringify([cell.raceType, cell.distanceMetres]),
      ),
    );
    expect(
      [...publishedMapCells].filter((key) => !officialWeekOneCells.has(key)),
    ).toEqual([JSON.stringify(["12 gate madness", 1_000])]);
  });

  it("fails closed on incomplete or internally conflicting aggregate authority", () => {
    const valid = {
      source: "Completed official races",
      dataCurrentThrough: "2026-09-23T06:36:45.070Z",
      completedMatches: 1,
      scoredRaces: 1,
      resultCount: 2,
      participatingCoreCount: 2,
      exactCellCount: 1,
      validation: "Complete exact authority",
      cells: [
        {
          race_type: "1v1",
          distance_m: 1000,
          gate: 2,
          scoring: "wta_win",
          race_count: 1,
          unique_core_count: 2,
          sample_status: "early_signal",
          first_place_times: {
            n: 1,
            fastest_seconds: 55,
            p25_seconds: 55,
            median_seconds: 55,
            p75_seconds: 55,
            slowest_seconds: 55,
            standard_deviation_seconds: 0,
            interquartile_range_seconds: 0,
          },
          positive_contributor_times: {
            n: 1,
            fastest_seconds: 55,
            p25_seconds: 55,
            median_seconds: 55,
            p75_seconds: 55,
            slowest_seconds: 55,
            standard_deviation_seconds: 0,
            interquartile_range_seconds: 0,
          },
          podium_cutoff_times: null,
          targets: {
            elite_seconds: 55,
            expected_winning_seconds: 55,
            maximum_positive_seconds: 55,
          },
        },
      ],
    };

    expect(() =>
      loadProLeagueSeason1Week1Benchmark({ ...valid, scoredRaces: 2 }),
    ).toThrow("race count is inconsistent");
    expect(() =>
      loadProLeagueSeason1Week1Benchmark({
        ...valid,
        cells: [
          {
            ...valid.cells[0],
            targets: {
              ...valid.cells[0]!.targets,
              elite_seconds: 54,
            },
          },
        ],
      }),
    ).toThrow("targets conflict");
  });
});
