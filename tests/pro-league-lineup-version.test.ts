import { describe, expect, it } from "vitest";

import {
  buildProLeagueLineupVersion,
  buildProLeagueMatchLock,
  proLeagueLineupAuthority,
} from "@/domain/pro-league-lineup-version";
import { proLeagueMaps } from "@/domain/pro-league-maps";

const rosterCoreIds = ["core-1", "core-2"];

function completeAssignments() {
  return proLeagueMaps.flatMap((map) =>
    map.races.map((race) => ({
      mapId: map.mapId,
      raceNumber: race.raceNumber,
      coreId: race.raceNumber % 2 === 0 ? "core-2" : "core-1",
      scope: "single_race" as const,
    })),
  );
}

function lineup() {
  return buildProLeagueLineupVersion({
    lineupVersionId: "lineup-v1",
    versionNumber: 1,
    rosterVersionId: "roster-v1",
    rosterCoreIds,
    rationale: "Complete reusable four-map assignment.",
    assignments: completeAssignments(),
  });
}

describe("Pro League lineup versions and match locks", () => {
  it("freezes a complete Bike-only snapshot of all four published maps", () => {
    const value = lineup();

    expect(proLeagueLineupAuthority).toMatchObject({
      publishedMapCount: 4,
      raceLinesPerMap: 42,
      raceMode: "bike",
      matchSubmission: "manual_only",
    });
    expect(value.maps).toHaveLength(4);
    expect(value.maps.flatMap(({ entries }) => entries)).toHaveLength(168);
    expect(
      value.maps.every(({ entries }) =>
        entries.every(({ mode }) => mode === "bike"),
      ),
    ).toBe(true);
  });

  it("rejects incomplete lineups and non-roster assignments", () => {
    expect(() =>
      buildProLeagueLineupVersion({
        lineupVersionId: "lineup-v1",
        versionNumber: 1,
        rosterVersionId: "roster-v1",
        rosterCoreIds,
        rationale: "Incomplete.",
        assignments: completeAssignments().slice(0, -1),
      }),
    ).toThrow("must assign all 42 races");

    const assignments = completeAssignments();
    assignments[0] = { ...assignments[0]!, coreId: "not-rostered" };
    expect(() =>
      buildProLeagueLineupVersion({
        lineupVersionId: "lineup-v1",
        versionNumber: 1,
        rosterVersionId: "roster-v1",
        rosterCoreIds,
        rationale: "Invalid Core.",
        assignments,
      }),
    ).toThrow("not on the roster");
  });

  it("locks the exact lineup and roster versions to a two-Vault match", () => {
    expect(
      buildProLeagueMatchLock({
        matchLockId: "match-lock-1",
        matchId: "match-1",
        lineup: lineup(),
        ourVaultId: "vault-away",
        homeVaultId: "vault-home",
        awayVaultId: "vault-away",
        scheduledAt: "2026-09-08T10:00:00.000Z",
        lockedAt: "2026-09-08T09:00:00.000Z",
        rulesetSource: "official-match-page/match-1",
        thirdMapPolicy: "denied_map_excluded",
        homeMapPick: "map-1",
        homeDeniedMap: "map-4",
        awayMapPick: "map-2",
        thirdMap: "map-3",
      }),
    ).toMatchObject({
      lineupVersionId: "lineup-v1",
      rosterVersionId: "roster-v1",
      ourSide: "away",
      selection: {
        map1: "map-1",
        map2: "map-2",
        deniedMap: "map-4",
        thirdMap: "map-3",
        thirdMapResolution: "fixed_remaining_map",
      },
      fallback: null,
    });
  });

  it("retains the match-specific third-map policy and explicit fallback source", () => {
    const value = buildProLeagueMatchLock({
      matchLockId: "match-lock-2",
      matchId: "match-2",
      lineup: lineup(),
      ourVaultId: "vault-home",
      homeVaultId: "vault-home",
      awayVaultId: "vault-away",
      scheduledAt: "2026-09-08T10:00:00.000Z",
      lockedAt: "2026-09-08T09:00:00.000Z",
      rulesetSource: "owner-confirmed-ruleset/match-2",
      thirdMapPolicy: "denied_map_returns_to_random_pool",
      homeMapPick: "map-3",
      homeDeniedMap: "map-4",
      awayMapPick: "map-1",
      thirdMap: "map-4",
      fallback: {
        source: "owner_recorded",
        reference: "private-match-note-2",
      },
    });

    expect(value.selection).toMatchObject({
      policy: "denied_map_returns_to_random_pool",
      thirdMapCandidates: ["map-2", "map-4"],
      thirdMap: "map-4",
    });
    expect(value.fallback).toEqual({
      source: "owner_recorded",
      reference: "private-match-note-2",
    });
  });

  it("rejects non-participants, late locks and disallowed map choices", () => {
    const common = {
      matchLockId: "match-lock-1",
      matchId: "match-1",
      lineup: lineup(),
      ourVaultId: "vault-other",
      homeVaultId: "vault-home",
      awayVaultId: "vault-away",
      scheduledAt: "2026-09-08T10:00:00.000Z",
      lockedAt: "2026-09-08T09:00:00.000Z",
      rulesetSource: "official-match-page/match-1",
      thirdMapPolicy: "denied_map_excluded" as const,
      homeMapPick: "map-1" as const,
      homeDeniedMap: "map-4" as const,
      awayMapPick: "map-2" as const,
      thirdMap: "map-3" as const,
    };
    expect(() => buildProLeagueMatchLock(common)).toThrow("participant");
    expect(() =>
      buildProLeagueMatchLock({
        ...common,
        ourVaultId: "vault-home",
        lockedAt: "2026-09-08T11:00:00.000Z",
      }),
    ).toThrow("no later than match start");
    expect(() =>
      buildProLeagueMatchLock({
        ...common,
        ourVaultId: "vault-home",
        awayMapPick: "map-4",
      }),
    ).toThrow("two maps left");
    const { thirdMap: _thirdMap, ...withoutThirdMap } = common;
    void _thirdMap;
    expect(() =>
      buildProLeagueMatchLock({
        ...withoutThirdMap,
        ourVaultId: "vault-home",
      }),
    ).toThrow("requires a resolved third map");
  });
});
