import { describe, expect, it } from "vitest";

import { buildProLeagueEsportsBenchmark } from "@/domain/pro-league-esports-benchmark";
import {
  ownerVerifiedBikeAgeing,
  requireCurrentBikeAgeingEvidence,
  screenOwnedBikePace,
} from "@/domain/pro-league-owned-bike-pace";

const currentThrough = "2026-09-23T06:36:45.070Z";

function benchmark() {
  const races = Array.from({ length: 5 }, (_, index) => ({
    matchId: `match-${index}`,
    raceId: `race-${index}`,
    mapId: "anchor",
    raceNumber: index + 1,
    raceType: "1v1",
    distanceMetres: 1000,
    gateCount: 2,
    scoring: "wta_win" as const,
    homeTeamId: "home",
    awayTeamId: "away",
    pointTo: "home" as const,
    homeCoreIds: [`h${index}`],
    awayCoreIds: [`a${index}`],
    completedAt: currentThrough,
  }));
  return buildProLeagueEsportsBenchmark({
    races,
    results: races.flatMap((race, index) => [
      {
        raceId: race.raceId,
        coreId: `h${index}`,
        finishPosition: 1,
        elapsedTimeMilliseconds: 50_000,
      },
      {
        raceId: race.raceId,
        coreId: `a${index}`,
        finishPosition: 2,
        elapsedTimeMilliseconds: 53_000,
      },
    ]),
  });
}

describe("owned Bike pace and owner-confirmed ageing", () => {
  it("uses verified current balance and excludes excess use and unknown values", () => {
    expect(ownerVerifiedBikeAgeing(625)).toEqual({
      used: 400,
      remaining: 625,
      eligible: true,
    });
    expect(ownerVerifiedBikeAgeing(624).eligible).toBe(false);
    expect(() => ownerVerifiedBikeAgeing(Number.NaN)).toThrow();
    expect(() => ownerVerifiedBikeAgeing(1026)).toThrow();
    expect(
      requireCurrentBikeAgeingEvidence({
        balance: 625,
        observedAt: "2026-09-22T06:36:45.070Z",
        currentThrough,
      }).eligible,
    ).toBe(true);
    expect(() =>
      requireCurrentBikeAgeingEvidence({
        balance: 625,
        observedAt: "2026-09-18T06:36:45.070Z",
        currentThrough,
      }),
    ).toThrow("current");
  });

  it("accepts repeatable normal Bike timing as a distance projection without esports starts", () => {
    const finishes = Array.from({ length: 10 }, (_, index) => ({
      distanceMetres: 1000,
      elapsedTimeMilliseconds: 49_900 + index * 20,
      completedAt: currentThrough,
      source: "normal_bike" as const,
    }));
    expect(
      screenOwnedBikePace({
        finishes,
        benchmark: benchmark(),
        currentThrough,
      })[0],
    ).toMatchObject({
      status: "elite_range",
      sampleCount: 10,
      distanceOnlyProjection: true,
    });
    expect(
      screenOwnedBikePace({
        finishes: finishes.slice(0, 9),
        benchmark: benchmark(),
        currentThrough,
      })[0]?.status,
    ).toBe("provisional");
    expect(
      screenOwnedBikePace({
        finishes: finishes.map((finish, index) => ({
          ...finish,
          completedAt: index < 8 ? "2026-01-01T00:00:00.000Z" : currentThrough,
        })),
        benchmark: benchmark(),
        currentThrough,
      })[0],
    ).toMatchObject({
      sampleCount: 10,
      recentSampleCount: 2,
      status: "provisional",
    });
  });
});
