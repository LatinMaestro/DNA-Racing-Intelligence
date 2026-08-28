export type ProLeagueMapId = "map-1" | "map-2" | "map-3" | "map-4";

export type ProLeagueMapAssignmentScope =
  "single_race" | "same_type_and_distance";

export type ProLeagueMapRace = Readonly<{
  raceNumber: number;
  mode: "bike";
  raceType: string;
  distanceMetres: number;
}>;

export type ProLeagueMap = Readonly<{
  mapId: ProLeagueMapId;
  mapNumber: number;
  name: string;
  races: readonly ProLeagueMapRace[];
}>;

type RaceTuple = readonly [raceType: string, distanceMetres: number];

function defineMap(
  mapNumber: 1 | 2 | 3 | 4,
  name: string,
  races: readonly RaceTuple[],
): ProLeagueMap {
  if (races.length !== 42) {
    throw new Error(
      `Pro League map ${mapNumber} must define exactly 42 races.`,
    );
  }
  return Object.freeze({
    mapId: `map-${mapNumber}`,
    mapNumber,
    name,
    races: Object.freeze(
      races.map(([raceType, distanceMetres], index) =>
        Object.freeze({
          raceNumber: index + 1,
          mode: "bike" as const,
          raceType,
          distanceMetres,
        }),
      ),
    ),
  });
}

const anchor = defineMap(1, "Anchor", [
  ["1v1", 1000],
  ["6 gate madness", 1000],
  ["12 gate WTA", 1200],
  ["1v1", 1400],
  ["6 gate madness", 1200],
  ["1v1", 1800],
  ["6 gate madness", 1600],
  ["12 gate WTA", 1800],
  ["1v1", 2200],
  ["6 gate madness", 2000],
  ["6 gate madness", 2200],
  ["1v1", 1000],
  ["6 gate madness", 1000],
  ["1v1", 1400],
  ["6 gate madness", 1200],
  ["1v1", 1800],
  ["6 gate madness", 1600],
  ["1v1", 2200],
  ["1v1", 1000],
  ["6 gate madness", 1200],
  ["6 gate madness", 2000],
  ["6 gate madness", 2200],
  ["1v1", 2200],
  ["1v1", 1000],
  ["1v1", 1400],
  ["6 gate madness", 2000],
  ["1v1", 1800],
  ["6 gate madness", 1000],
  ["1v1", 2200],
  ["6 gate madness", 1200],
  ["6 gate madness", 1600],
  ["1v1", 1200],
  ["6 gate madness", 2000],
  ["6 gate madness", 1400],
  ["6 gate madness", 1200],
  ["1v1", 2200],
  ["6 gate madness", 2000],
  ["1v1", 1400],
  ["6 gate madness", 1600],
  ["6 gate madness", 1600],
  ["1v1", 1600],
  ["1v1", 2000],
]);

const glory = defineMap(2, "Glory", [
  ["4 gate WTA", 1000],
  ["6 gate WTA", 1200],
  ["16 gate WTA", 1400],
  ["24 gate WTA", 1600],
  ["4 gate WTA", 1800],
  ["6 gate WTA", 2000],
  ["16 gate WTA", 2200],
  ["24 gate WTA", 1200],
  ["4 gate WTA", 2200],
  ["6 gate WTA", 2000],
  ["16 gate WTA", 2200],
  ["24 gate WTA", 1600],
  ["4 gate WTA", 1400],
  ["6 gate WTA", 1400],
  ["16 gate WTA", 1000],
  ["24 gate WTA", 1400],
  ["4 gate WTA", 1000],
  ["6 gate WTA", 1200],
  ["16 gate WTA", 1400],
  ["24 gate WTA", 1600],
  ["4 gate WTA", 1800],
  ["6 gate WTA", 2000],
  ["16 gate WTA", 1600],
  ["24 gate WTA", 1800],
  ["4 gate WTA", 2200],
  ["6 gate WTA", 1400],
  ["16 gate WTA", 1800],
  ["24 gate WTA", 1600],
  ["4 gate WTA", 1400],
  ["6 gate WTA", 1200],
  ["16 gate WTA", 1000],
  ["24 gate WTA", 2200],
  ["4 gate WTA", 1000],
  ["6 gate WTA", 1200],
  ["16 gate WTA", 1400],
  ["24 gate WTA", 1600],
  ["4 gate WTA", 1800],
  ["6 gate WTA", 1400],
  ["16 gate WTA", 2200],
  ["24 gate WTA", 1200],
  ["4 gate WTA", 2000],
  ["6 gate WTA", 2000],
]);

const measure = defineMap(3, "Measure", [
  ["4 gate WTA", 2000],
  ["6 gate WTA", 2200],
  ["1v1", 1000],
  ["6 gate madness", 2200],
  ["12 gate madness", 2000],
  ["24 gate madness", 1800],
  ["4 gate WTA", 1600],
  ["6 gate WTA", 1200],
  ["1v1", 1600],
  ["6 gate madness", 1000],
  ["12 gate madness", 1400],
  ["24 gate madness", 1000],
  ["4 gate WTA", 1200],
  ["6 gate WTA", 2000],
  ["1v1", 1600],
  ["6 gate madness", 1800],
  ["12 gate madness", 2000],
  ["24 gate madness", 2200],
  ["4 gate WTA", 1800],
  ["6 gate WTA", 1800],
  ["1v1", 2000],
  ["6 gate madness", 1600],
  ["12 gate madness", 1000],
  ["24 gate madness", 1200],
  ["4 gate WTA", 1400],
  ["6 gate WTA", 1600],
  ["1v1", 1400],
  ["6 gate madness", 1800],
  ["12 gate madness", 1800],
  ["24 gate madness", 2200],
  ["4 gate WTA", 1800],
  ["6 gate WTA", 2200],
  ["1v1", 2000],
  ["6 gate madness", 1800],
  ["12 gate madness", 1000],
  ["24 gate madness", 1200],
  ["4 gate WTA", 1400],
  ["6 gate WTA", 1600],
  ["1v1", 1000],
  ["6 gate madness", 1200],
  ["12 gate madness", 1400],
  ["24 gate madness", 1600],
]);

const miracles = defineMap(4, "Miracles", [
  ["22 gate WTA", 2000],
  ["24 gate madness", 2200],
  ["22 gate WTA", 1000],
  ["24 gate madness", 2200],
  ["22 gate WTA", 2000],
  ["24 gate madness", 1800],
  ["22 gate WTA", 1600],
  ["24 gate madness", 1400],
  ["22 gate WTA", 1200],
  ["24 gate madness", 2200],
  ["22 gate WTA", 1400],
  ["24 gate madness", 1000],
  ["22 gate WTA", 2200],
  ["24 gate madness", 1400],
  ["22 gate WTA", 1600],
  ["24 gate madness", 1800],
  ["22 gate WTA", 2000],
  ["24 gate madness", 2200],
  ["22 gate WTA", 1200],
  ["24 gate madness", 2200],
  ["22 gate WTA", 1000],
  ["24 gate madness", 1800],
  ["22 gate WTA", 1000],
  ["24 gate madness", 1200],
  ["22 gate WTA", 1400],
  ["24 gate madness", 1600],
  ["22 gate WTA", 1000],
  ["24 gate madness", 1800],
  ["22 gate WTA", 2000],
  ["24 gate madness", 2200],
  ["22 gate WTA", 1800],
  ["24 gate madness", 2200],
  ["22 gate WTA", 2000],
  ["24 gate madness", 1800],
  ["22 gate WTA", 1000],
  ["24 gate madness", 1200],
  ["22 gate WTA", 1400],
  ["24 gate madness", 1600],
  ["22 gate WTA", 1000],
  ["24 gate madness", 1200],
  ["22 gate WTA", 1400],
  ["24 gate madness", 1400],
]);

export const proLeagueMapAuthority = Object.freeze({
  catalogueId: "dna-pro-league/maps-observed-2026-08-27",
  sourceUrl: "https://esports.dnaracing.run/maps/",
  observedAt: "2026-08-27",
  evidenceStatus: "owner_confirmed_public_page" as const,
  raceMode: "bike" as const,
  matchFormat: Object.freeze({
    bestOfMaps: 3,
    racesPerMap: 42,
    firstToRacePoints: 16,
    winByRacePoints: 2,
  }),
  plannedMapCount: 5,
  definedMapCount: 4,
  earliestPossibleFinishRace: 16,
});

export const proLeagueMaps = Object.freeze([
  anchor,
  glory,
  measure,
  miracles,
]) satisfies readonly ProLeagueMap[];

export type ProLeagueMapAssignmentCommand = Readonly<{
  mapId: ProLeagueMapId;
  raceNumber: number;
  coreId: string;
  scope: ProLeagueMapAssignmentScope;
}>;

export type ProLeagueMapLineupEntry = ProLeagueMapRace &
  Readonly<{
    mapId: ProLeagueMapId;
    coreId: string;
    sourceRaceNumber: number;
    scope: ProLeagueMapAssignmentScope;
  }>;

function mapById(mapId: ProLeagueMapId): ProLeagueMap {
  const map = proLeagueMaps.find((candidate) => candidate.mapId === mapId);
  if (map === undefined) throw new Error(`Unknown Pro League map: ${mapId}.`);
  return map;
}

export function resolveProLeagueMapAssignment(
  command: ProLeagueMapAssignmentCommand,
): readonly ProLeagueMapLineupEntry[] {
  const coreId = command.coreId.trim();
  if (coreId === "") throw new Error("A mapped Core ID must not be blank.");
  if (
    command.scope !== "single_race" &&
    command.scope !== "same_type_and_distance"
  ) {
    throw new Error("Pro League map assignment scope is invalid.");
  }
  const map = mapById(command.mapId);
  const sourceRace = map.races.find(
    ({ raceNumber }) => raceNumber === command.raceNumber,
  );
  if (sourceRace === undefined) {
    throw new Error(
      `Race ${command.raceNumber} is not defined for ${command.mapId}.`,
    );
  }
  const races =
    command.scope === "single_race"
      ? [sourceRace]
      : map.races.filter(
          ({ raceType, distanceMetres }) =>
            raceType === sourceRace.raceType &&
            distanceMetres === sourceRace.distanceMetres,
        );
  return races.map((race) => ({
    ...race,
    mapId: command.mapId,
    coreId,
    sourceRaceNumber: sourceRace.raceNumber,
    scope: command.scope,
  }));
}

export function buildProLeagueMapLineup(
  input: Readonly<{
    mapId: ProLeagueMapId;
    rosterCoreIds: readonly string[];
    assignments: readonly ProLeagueMapAssignmentCommand[];
  }>,
): Readonly<{
  map: ProLeagueMap;
  entries: readonly ProLeagueMapLineupEntry[];
  assignedRaceCount: number;
  assignedFirst16Count: number;
  unassignedRaceNumbers: readonly number[];
}> {
  const map = mapById(input.mapId);
  const roster = new Set(input.rosterCoreIds.map((coreId) => coreId.trim()));
  if (roster.has("")) throw new Error("Roster Core IDs must not be blank.");
  const entries = new Map<number, ProLeagueMapLineupEntry>();
  for (const command of input.assignments) {
    if (command.mapId !== input.mapId) {
      throw new Error(
        "A map lineup cannot contain assignments for another map.",
      );
    }
    const normalizedCoreId = command.coreId.trim();
    if (!roster.has(normalizedCoreId)) {
      throw new Error(`Mapped Core ${normalizedCoreId} is not on the roster.`);
    }
    for (const resolved of resolveProLeagueMapAssignment(command)) {
      const existing = entries.get(resolved.raceNumber);
      if (existing !== undefined && existing.coreId !== resolved.coreId) {
        throw new Error(
          `Race ${resolved.raceNumber} has conflicting Core assignments.`,
        );
      }
      entries.set(resolved.raceNumber, resolved);
    }
  }
  const orderedEntries = [...entries.values()].sort(
    (left, right) => left.raceNumber - right.raceNumber,
  );
  return {
    map,
    entries: orderedEntries,
    assignedRaceCount: orderedEntries.length,
    assignedFirst16Count: orderedEntries.filter(
      ({ raceNumber }) => raceNumber <= 16,
    ).length,
    unassignedRaceNumbers: map.races
      .filter(({ raceNumber }) => !entries.has(raceNumber))
      .map(({ raceNumber }) => raceNumber),
  };
}
