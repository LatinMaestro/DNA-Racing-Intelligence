import { describe, expect, it } from "vitest";

import {
  proLeagueTrialMapGuidance,
  proLeagueTrialOperationsAuthority,
  resolveProLeagueMapSelection,
  scoreProLeagueMap,
  scoreProLeagueMatch,
  type ProLeagueTeamSide,
} from "@/domain/pro-league-competition";

describe("Pro League competition operations", () => {
  it("records trial setup, scheduling, standings and practice-only exceptions", () => {
    expect(proLeagueTrialOperationsAuthority).toMatchObject({
      appliesTo: "trial_only",
      setup: {
        minimumRosterSize: 12,
        maximumRosterSize: 25,
        configureAllPublishedMaps: true,
        lineupsPersistAcrossMatches: true,
        lineupsEditableUntilMatchLock: true,
      },
      scheduling: {
        expectedNotice: "about_one_day",
        trialDayPresentation: "one_week_tab_per_practice_day",
      },
      mapSelection: {
        homeAction: "pick_map_1_and_deny_one_map",
        awayAction: "pick_map_2_after_home_action",
        thirdMapPolicy: "match_ruleset_required",
      },
      standings: { winPoints: 3, drawPoints: 1, lossPoints: 0 },
      practiceOverrides: {
        ageing: "disabled",
        rosterChanges: "unlimited_before_match_lock",
      },
    });
    expect(proLeagueTrialMapGuidance.evidenceStatus).toBe(
      "organizer_trial_guidance_not_predictive_authority",
    );
  });

  it("resolves the third map under the denied-map-excluded trial wording", () => {
    expect(
      resolveProLeagueMapSelection({
        policy: "denied_map_excluded",
        homeMapPick: "map-1",
        homeDeniedMap: "map-4",
        awayMapPick: "map-2",
        thirdMap: "map-3",
      }),
    ).toEqual({
      policy: "denied_map_excluded",
      map1: "map-1",
      map2: "map-2",
      deniedMap: "map-4",
      thirdMapCandidates: ["map-3"],
      thirdMap: "map-3",
      thirdMapResolution: "fixed_remaining_map",
    });
  });

  it("retains the alternate observed rule where the denied map returns", () => {
    expect(
      resolveProLeagueMapSelection({
        policy: "denied_map_returns_to_random_pool",
        homeMapPick: "map-3",
        homeDeniedMap: "map-4",
        awayMapPick: "map-1",
        thirdMap: "map-4",
      }),
    ).toMatchObject({
      thirdMapCandidates: ["map-2", "map-4"],
      thirdMap: "map-4",
      thirdMapResolution: "random_draw_required",
    });
  });

  it("rejects an away pick or third map that its match ruleset disallows", () => {
    expect(() =>
      resolveProLeagueMapSelection({
        policy: "denied_map_excluded",
        homeMapPick: "map-1",
        homeDeniedMap: "map-4",
        awayMapPick: "map-4",
      }),
    ).toThrow("two maps left");
    expect(() =>
      resolveProLeagueMapSelection({
        policy: "denied_map_excluded",
        homeMapPick: "map-1",
        homeDeniedMap: "map-4",
        awayMapPick: "map-2",
        thirdMap: "map-4",
      }),
    ).toThrow("not allowed");
  });

  it("stops a map at 16 only with a two-point lead", () => {
    expect(scoreProLeagueMap(Array.from({ length: 16 }, () => "home"))).toEqual(
      {
        state: "complete",
        homeRacePoints: 16,
        awayRacePoints: 0,
        racesRun: 16,
        winner: "home",
        decidingRaceNumber: 16,
      },
    );

    const tiedAtThirty: ProLeagueTeamSide[] = Array.from(
      { length: 30 },
      (_, index) => (index % 2 === 0 ? "home" : "away"),
    );
    expect(scoreProLeagueMap([...tiedAtThirty, "home", "away"])).toMatchObject({
      state: "in_progress",
      homeRacePoints: 16,
      awayRacePoints: 16,
      winner: null,
    });
    expect(
      scoreProLeagueMap([...tiedAtThirty, "home", "away", "home", "home"]),
    ).toMatchObject({
      state: "complete",
      homeRacePoints: 18,
      awayRacePoints: 16,
      decidingRaceNumber: 34,
    });
  });

  it("does not invent a winner if all 42 catalogue races end without win-by-two", () => {
    const tied: ProLeagueTeamSide[] = Array.from({ length: 42 }, (_, index) =>
      index % 2 === 0 ? "home" : "away",
    );
    expect(scoreProLeagueMap(tied)).toMatchObject({
      state: "catalogue_exhausted_without_winner",
      homeRacePoints: 21,
      awayRacePoints: 21,
      winner: null,
    });
  });

  it("ends a best-of-three match at two map wins", () => {
    expect(scoreProLeagueMatch(["away", "away"])).toEqual({
      state: "complete",
      homeMapWins: 0,
      awayMapWins: 2,
      mapsRun: 2,
      winner: "away",
    });
    expect(() => scoreProLeagueMatch(["home", "home", "away"])).toThrow(
      "cannot continue",
    );
    expect(() =>
      scoreProLeagueMap([
        ...Array.from({ length: 16 }, () => "home" as const),
        "away",
      ]),
    ).toThrow("cannot continue");
  });
});
