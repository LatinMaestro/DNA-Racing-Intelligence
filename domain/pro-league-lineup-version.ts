import {
  buildProLeagueMapLineup,
  proLeagueMapAuthority,
  proLeagueMaps,
  type ProLeagueMapAssignmentCommand,
  type ProLeagueMapId,
  type ProLeagueMapLineupEntry,
} from "@/domain/pro-league-maps";
import {
  resolveProLeagueMapSelection,
  type ProLeagueMapSelection,
  type ProLeagueTeamSide,
  type ProLeagueThirdMapPolicy,
} from "@/domain/pro-league-competition";

const ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu;

export const proLeagueLineupAuthority = Object.freeze({
  authorityId: "dna-pro-league/lineup-lock-2026-08-29",
  mapCatalogueId: proLeagueMapAuthority.catalogueId,
  publishedMapCount: 4,
  raceLinesPerMap: 42,
  raceMode: "bike" as const,
  assignmentScopes: Object.freeze([
    "single_race",
    "same_type_and_distance",
  ] as const),
  mappedCoresMustComeFromRoster: true,
  matchSubmission: "manual_only" as const,
});

export type ProLeagueLineupMapSnapshot = Readonly<{
  mapId: ProLeagueMapId;
  entries: readonly ProLeagueMapLineupEntry[];
}>;

export type ProLeagueLineupVersion = Readonly<{
  lineupVersionId: string;
  versionNumber: number;
  rosterVersionId: string;
  authorityId: string;
  mapCatalogueId: string;
  rationale: string;
  maps: readonly ProLeagueLineupMapSnapshot[];
}>;

export type ProLeagueMatchLockFallback = Readonly<{
  source: "official_match_page" | "owner_recorded" | "trial_missed_pick";
  reference: string;
}>;

export type ProLeagueMatchLock = Readonly<{
  matchLockId: string;
  matchId: string;
  lineupVersionId: string;
  rosterVersionId: string;
  ourVaultId: string;
  homeVaultId: string;
  awayVaultId: string;
  ourSide: ProLeagueTeamSide;
  scheduledAt: string;
  lockedAt: string;
  rulesetSource: string;
  selection: ProLeagueMapSelection;
  fallback: ProLeagueMatchLockFallback | null;
}>;

function text(value: string, label: string, maximum = 2_000): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximum) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return normalized;
}

function id(value: string, label: string): string {
  const normalized = text(value, label, 128);
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return normalized;
}

function instant(value: string, label: string): string {
  const normalized = text(value, label, 64);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new Error(`Pro League ${label} must be an ISO timestamp.`);
  }
  return normalized;
}

export function buildProLeagueLineupVersion(
  input: Readonly<{
    lineupVersionId: string;
    versionNumber: number;
    rosterVersionId: string;
    rosterCoreIds: readonly string[];
    rationale: string;
    assignments: readonly ProLeagueMapAssignmentCommand[];
  }>,
): ProLeagueLineupVersion {
  if (!Array.isArray(input.assignments) || input.assignments.length > 168) {
    throw new Error("Pro League lineup assignments are invalid.");
  }
  const entries = proLeagueMaps.flatMap(({ mapId }) => {
    const lineup = buildProLeagueMapLineup({
      mapId,
      rosterCoreIds: input.rosterCoreIds,
      assignments: input.assignments.filter(
        (assignment) => assignment.mapId === mapId,
      ),
    });
    if (lineup.assignedRaceCount !== 42) {
      throw new Error(`Pro League ${mapId} lineup must assign all 42 races.`);
    }
    return lineup.entries;
  });
  return restoreProLeagueLineupVersion({
    lineupVersionId: input.lineupVersionId,
    versionNumber: input.versionNumber,
    rosterVersionId: input.rosterVersionId,
    rosterCoreIds: input.rosterCoreIds,
    authorityId: proLeagueLineupAuthority.authorityId,
    mapCatalogueId: proLeagueLineupAuthority.mapCatalogueId,
    rationale: input.rationale,
    entries,
  });
}

export function restoreProLeagueLineupVersion(
  input: Readonly<{
    lineupVersionId: string;
    versionNumber: number;
    rosterVersionId: string;
    rosterCoreIds: readonly string[];
    authorityId: string;
    mapCatalogueId: string;
    rationale: string;
    entries: readonly ProLeagueMapLineupEntry[];
  }>,
): ProLeagueLineupVersion {
  const lineupVersionId = id(input.lineupVersionId, "lineup version ID");
  const rosterVersionId = id(input.rosterVersionId, "roster version ID");
  if (!Number.isSafeInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new Error("Pro League lineup version number is invalid.");
  }
  if (
    input.authorityId !== proLeagueLineupAuthority.authorityId ||
    input.mapCatalogueId !== proLeagueLineupAuthority.mapCatalogueId
  ) {
    throw new Error("Pro League lineup authority is invalid.");
  }
  if (!Array.isArray(input.entries) || input.entries.length !== 168) {
    throw new Error("Pro League lineup must preserve all 168 published lines.");
  }
  const roster = new Set(
    input.rosterCoreIds.map((value) => id(value, "roster Core ID")),
  );
  const maps = proLeagueMaps.map((map) => {
    const entries = input.entries
      .filter((entry) => entry.mapId === map.mapId)
      .sort((left, right) => left.raceNumber - right.raceNumber);
    if (entries.length !== 42) {
      throw new Error(
        `Pro League ${map.mapId} lineup must assign all 42 races.`,
      );
    }
    entries.forEach((entry, index) => {
      const race = map.races[index]!;
      if (
        entry.raceNumber !== race.raceNumber ||
        entry.mode !== race.mode ||
        entry.raceType !== race.raceType ||
        entry.distanceMetres !== race.distanceMetres ||
        entry.totalGateEntries !== race.totalGateEntries ||
        entry.gateEntriesPerVault !== race.gateEntriesPerVault ||
        !roster.has(id(entry.coreId, "mapped Core ID"))
      ) {
        throw new Error(
          "Pro League lineup entry conflicts with map or roster authority.",
        );
      }
      const source = map.races[entry.sourceRaceNumber - 1];
      if (
        source === undefined ||
        (entry.scope !== "single_race" &&
          entry.scope !== "same_type_and_distance") ||
        (entry.scope === "single_race" &&
          entry.sourceRaceNumber !== entry.raceNumber) ||
        (entry.scope === "same_type_and_distance" &&
          (source.raceType !== entry.raceType ||
            source.distanceMetres !== entry.distanceMetres))
      ) {
        throw new Error("Pro League lineup assignment provenance is invalid.");
      }
    });
    return Object.freeze({ mapId: map.mapId, entries: Object.freeze(entries) });
  });
  return Object.freeze({
    lineupVersionId,
    versionNumber: input.versionNumber,
    rosterVersionId,
    authorityId: input.authorityId,
    mapCatalogueId: input.mapCatalogueId,
    rationale: text(input.rationale, "lineup rationale"),
    maps: Object.freeze(maps),
  });
}

export function buildProLeagueMatchLock(
  input: Readonly<{
    matchLockId: string;
    matchId: string;
    lineup: ProLeagueLineupVersion;
    ourVaultId: string;
    homeVaultId: string;
    awayVaultId: string;
    scheduledAt: string;
    lockedAt: string;
    rulesetSource: string;
    thirdMapPolicy: ProLeagueThirdMapPolicy;
    homeMapPick: ProLeagueMapId;
    homeDeniedMap: ProLeagueMapId;
    awayMapPick: ProLeagueMapId;
    thirdMap?: ProLeagueMapId;
    fallback?: ProLeagueMatchLockFallback | null;
  }>,
): ProLeagueMatchLock {
  return restoreProLeagueMatchLock({
    ...input,
    lineupVersionId: input.lineup.lineupVersionId,
    rosterVersionId: input.lineup.rosterVersionId,
  });
}

export function restoreProLeagueMatchLock(
  input: Readonly<{
    matchLockId: string;
    matchId: string;
    lineupVersionId: string;
    rosterVersionId: string;
    ourVaultId: string;
    homeVaultId: string;
    awayVaultId: string;
    scheduledAt: string;
    lockedAt: string;
    rulesetSource: string;
    thirdMapPolicy: ProLeagueThirdMapPolicy;
    homeMapPick: ProLeagueMapId;
    homeDeniedMap: ProLeagueMapId;
    awayMapPick: ProLeagueMapId;
    thirdMap?: ProLeagueMapId;
    fallback?: ProLeagueMatchLockFallback | null;
  }>,
): ProLeagueMatchLock {
  const ourVaultId = id(input.ourVaultId, "our Vault ID");
  const homeVaultId = id(input.homeVaultId, "home Vault ID");
  const awayVaultId = id(input.awayVaultId, "away Vault ID");
  if (homeVaultId === awayVaultId) {
    throw new Error("Pro League match Vaults must be distinct.");
  }
  if (ourVaultId !== homeVaultId && ourVaultId !== awayVaultId) {
    throw new Error("Our Pro League Vault must be a match participant.");
  }
  const scheduledAt = instant(input.scheduledAt, "match schedule");
  const lockedAt = instant(input.lockedAt, "match lock timestamp");
  if (lockedAt > scheduledAt) {
    throw new Error("Pro League lineup must lock no later than match start.");
  }
  const fallback = input.fallback
    ? Object.freeze({
        source: input.fallback.source,
        reference: text(input.fallback.reference, "fallback reference", 512),
      })
    : null;
  if (
    fallback !== null &&
    !["official_match_page", "owner_recorded", "trial_missed_pick"].includes(
      fallback.source,
    )
  ) {
    throw new Error("Pro League match fallback source is invalid.");
  }
  if (input.thirdMap === undefined) {
    throw new Error("Pro League match lock requires a resolved third map.");
  }
  return Object.freeze({
    matchLockId: id(input.matchLockId, "match lock ID"),
    matchId: id(input.matchId, "match ID"),
    lineupVersionId: id(input.lineupVersionId, "lineup version ID"),
    rosterVersionId: id(input.rosterVersionId, "roster version ID"),
    ourVaultId,
    homeVaultId,
    awayVaultId,
    ourSide: ourVaultId === homeVaultId ? "home" : "away",
    scheduledAt,
    lockedAt,
    rulesetSource: text(input.rulesetSource, "match ruleset source", 512),
    selection: resolveProLeagueMapSelection({
      policy: input.thirdMapPolicy,
      homeMapPick: input.homeMapPick,
      homeDeniedMap: input.homeDeniedMap,
      awayMapPick: input.awayMapPick,
      ...(input.thirdMap === undefined ? {} : { thirdMap: input.thirdMap }),
    }),
    fallback,
  });
}
