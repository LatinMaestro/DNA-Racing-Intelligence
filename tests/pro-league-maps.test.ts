import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  buildProLeagueMapLineup,
  proLeagueGateAllocation,
  proLeagueMapAuthority,
  proLeagueMaps,
  resolveProLeagueMapAssignment,
} from "@/domain/pro-league-maps";

describe("Pro League maps", () => {
  it("preserves the four published 42-race maps and leaves map five undefined", () => {
    expect(proLeagueMapAuthority).toMatchObject({
      raceMode: "bike",
      plannedMapCount: 5,
      definedMapCount: 4,
      matchFormat: {
        bestOfMaps: 3,
        racesPerMap: 42,
        firstToRacePoints: 16,
        winByRacePoints: 2,
        vaultsPerMatch: 2,
        gateAllocation: "equal_halves",
        homeVaultSelectsMaps: true,
        mappedCoresMustComeFromRoster: true,
      },
    });
    expect(proLeagueMaps.map(({ name }) => name)).toEqual([
      "Anchor",
      "Glory",
      "Measure",
      "Miracles",
    ]);
    expect(proLeagueMaps.every(({ races }) => races.length === 42)).toBe(true);
    expect(
      proLeagueMaps.every(({ races }) =>
        races.every(
          ({ raceNumber, mode }, index) =>
            raceNumber === index + 1 && mode === "bike",
        ),
      ),
    ).toBe(true);
  });

  it("keeps exact race type and distance authority for representative lines", () => {
    expect(proLeagueMaps[0]?.races[0]).toEqual({
      raceNumber: 1,
      mode: "bike",
      raceType: "1v1",
      distanceMetres: 1000,
      totalGateEntries: 2,
      gateEntriesPerVault: 1,
    });
    expect(proLeagueMaps[1]?.races[41]).toEqual({
      raceNumber: 42,
      mode: "bike",
      raceType: "6 gate WTA",
      distanceMetres: 2000,
      totalGateEntries: 6,
      gateEntriesPerVault: 3,
    });
    expect(proLeagueMaps[2]?.races[21]).toEqual({
      raceNumber: 22,
      mode: "bike",
      raceType: "6 gate madness",
      distanceMetres: 1600,
      totalGateEntries: 6,
      gateEntriesPerVault: 3,
    });
    expect(proLeagueMaps[3]?.races[40]).toEqual({
      raceNumber: 41,
      mode: "bike",
      raceType: "22 gate WTA",
      distanceMetres: 1400,
      totalGateEntries: 22,
      gateEntriesPerVault: 11,
    });
  });

  it("models the owner-confirmed equal split for every published race type", () => {
    expect(proLeagueGateAllocation("1v1")).toEqual({
      totalGateEntries: 2,
      gateEntriesPerVault: 1,
    });
    expect(proLeagueGateAllocation("24 gate madness")).toEqual({
      totalGateEntries: 24,
      gateEntriesPerVault: 12,
    });
    expect(
      proLeagueMaps.every(({ races }) =>
        races.every(
          ({ totalGateEntries, gateEntriesPerVault }) =>
            gateEntriesPerVault * 2 === totalGateEntries,
        ),
      ),
    ).toBe(true);
  });

  it("matches the full public 168-line catalogue fingerprint", () => {
    const canonical = proLeagueMaps.map(({ mapNumber, name, races }) => ({
      mapNumber,
      name,
      races: races.map(({ raceType, distanceMetres }) => [
        raceType,
        distanceMetres,
      ]),
    }));
    expect(
      createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    ).toBe("6efb624286dc2bae5e443a53055a39437525b2b3a0f23a4555fbb16006c88ebd");
  });

  it("can map one race without changing equivalent race lines", () => {
    expect(
      resolveProLeagueMapAssignment({
        mapId: "map-1",
        raceNumber: 1,
        coreId: "core-1",
        scope: "single_race",
      }),
    ).toEqual([
      expect.objectContaining({
        raceNumber: 1,
        coreId: "core-1",
        scope: "single_race",
      }),
    ]);
  });

  it("expands only within the selected map to the same type and distance", () => {
    const resolved = resolveProLeagueMapAssignment({
      mapId: "map-1",
      raceNumber: 1,
      coreId: "core-1",
      scope: "same_type_and_distance",
    });

    expect(resolved.map(({ raceNumber }) => raceNumber)).toEqual([
      1, 12, 19, 24,
    ]);
    expect(
      resolved.every(
        ({ mapId, raceType, distanceMetres }) =>
          mapId === "map-1" && raceType === "1v1" && distanceMetres === 1000,
      ),
    ).toBe(true);
  });

  it("reports first-16 coverage and rejects non-roster or conflicting mappings", () => {
    const lineup = buildProLeagueMapLineup({
      mapId: "map-1",
      rosterCoreIds: ["core-1", "core-2"],
      assignments: [
        {
          mapId: "map-1",
          raceNumber: 1,
          coreId: "core-1",
          scope: "same_type_and_distance",
        },
        {
          mapId: "map-1",
          raceNumber: 2,
          coreId: "core-2",
          scope: "single_race",
        },
      ],
    });

    expect(lineup.assignedRaceCount).toBe(5);
    expect(lineup.assignedFirst16Count).toBe(3);
    expect(lineup.unassignedRaceNumbers).not.toContain(1);
    expect(() =>
      buildProLeagueMapLineup({
        mapId: "map-1",
        rosterCoreIds: ["core-1"],
        assignments: [
          {
            mapId: "map-1",
            raceNumber: 2,
            coreId: "not-rostered",
            scope: "single_race",
          },
        ],
      }),
    ).toThrow("not on the roster");
    expect(() =>
      buildProLeagueMapLineup({
        mapId: "map-1",
        rosterCoreIds: ["core-1", "core-2"],
        assignments: [
          {
            mapId: "map-1",
            raceNumber: 1,
            coreId: "core-1",
            scope: "single_race",
          },
          {
            mapId: "map-1",
            raceNumber: 1,
            coreId: "core-2",
            scope: "single_race",
          },
        ],
      }),
    ).toThrow("conflicting");
  });
});
