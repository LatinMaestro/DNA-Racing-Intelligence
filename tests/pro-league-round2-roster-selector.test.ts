import { describe, expect, it } from "vitest";

import { proLeagueMaps } from "@/domain/pro-league-maps";
import type { Round2VerifiedCandidate } from "@/domain/pro-league-round2-full-gate-draft";
import { buildRound2NewRosterAndLineup } from "@/domain/pro-league-round2-roster-selector";

const now = "2026-09-23T09:44:57.874Z";

function pool(): Round2VerifiedCandidate[] {
  const cells = [
    ...new Map(
      proLeagueMaps.flatMap((map) =>
        map.races.map(
          (race) =>
            [
              JSON.stringify([
                race.raceType,
                race.distanceMetres,
                race.totalGateEntries,
              ]),
              race,
            ] as const,
        ),
      ),
    ).values(),
  ].map((race) => ({
    raceType: race.raceType,
    distanceMetres: race.distanceMetres,
    gateCount: race.totalGateEntries,
    scoring: race.raceType.toLowerCase().includes("madness")
      ? ("podium_majority" as const)
      : ("wta_win" as const),
    sampleCount: 20,
    recentSampleCount: 10,
    officialRaceCount: 20,
    medianMilliseconds: 50000,
    standardDeviationMilliseconds: 200,
    status: "elite_range" as const,
    distanceOnlyProjection: true as const,
  }));
  return Array.from({ length: 30 }, (_, index) => ({
    core: {
      coreId: String(100 + index),
      displayName: index === 0 ? "Genesis example" : `Owned ${index}`,
      element:
        index < 10
          ? ("Metal" as const)
          : index < 20
            ? ("Fire" as const)
            : ("Earth" as const),
      coreClass: index === 0 ? ("Genesis" as const) : ("Morphed" as const),
      sex: index % 2 === 0 ? ("female" as const) : ("male" as const),
      fNumber: 16,
      inMyVault: true,
    },
    bikeAgeingBalance: index === 1 ? 624 : 900,
    bikeAgeingObservedAt: now,
    completeOwnedBikeHistory: true as const,
    cells,
  }));
}

describe("Round 2 new-roster selector", () => {
  it("selects a fresh 25 from the full owned pool, respects caps and fills 168 gates", () => {
    const draft = buildRound2NewRosterAndLineup({
      completeOwnedPool: true,
      ownerVaultCoreCount: 30,
      owned: pool(),
      currentThrough: now,
    });
    expect(draft.inspectedOwnedCoreCount).toBe(30);
    expect(draft.excludedCandidateCount).toBe(2);
    expect(draft.selected).toHaveLength(25);
    expect(draft.selected.every((core) => core.eliteCellCount > 0)).toBe(true);
    expect(draft.lineup.lines).toHaveLength(168);
    expect(draft.lineup.substitutionsUsed).toBe(0);
    expect(
      draft.selected.every(
        (core) =>
          core.bikeAgeingUsedUpperBound === 125 &&
          core.ageingEvidence === "exact_balance",
      ),
    ).toBe(true);
    expect(
      draft.selected.some(({ coreId }) => coreId === "100" || coreId === "101"),
    ).toBe(false);
  });

  it("fails closed on an incomplete vault or fewer than 25 elite eligible Cores", () => {
    const owned = pool();
    expect(() =>
      buildRound2NewRosterAndLineup({
        completeOwnedPool: true,
        ownerVaultCoreCount: 31,
        owned,
        currentThrough: now,
      }),
    ).toThrow("Complete bounded owned Bike pool");
    expect(() =>
      buildRound2NewRosterAndLineup({
        completeOwnedPool: true,
        ownerVaultCoreCount: 30,
        owned: owned.map((candidate, index) =>
          index < 6
            ? {
                ...candidate,
                completeOwnedBikeHistory: false as never,
              }
            : candidate,
        ),
        currentThrough: now,
      }),
    ).toThrow("Every owned Bike history");
  });
});
