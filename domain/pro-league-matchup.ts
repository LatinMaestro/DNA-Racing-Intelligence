import type { FreshnessState } from "@/domain/freshness";
import {
  proLeagueMaps,
  type ProLeagueMapId,
  type ProLeagueMapRace,
} from "@/domain/pro-league-maps";
import {
  proLeagueCurrentRules,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";

export type ProLeagueMatchupAssessment =
  "winning_range" | "top_three_range" | "outside_top_three_range";

export type ProLeagueExactFormatEvidence = Readonly<{
  raceType: string;
  distanceMetres: number;
  raceCount: number;
  sampleStatus: "hypothesis_only" | "minimally_analytical";
  freshness: FreshnessState;
  dataCurrentThrough: string;
  benchmarkAssessment: ProLeagueMatchupAssessment;
}>;

export type ProLeagueMatchupCore = Pick<
  ProLeagueRosterCore,
  "coreId" | "displayName" | "element" | "coreClass" | "sex" | "fNumber"
> &
  Readonly<{
    rosterStatus: "rostered" | "not_rostered";
    exactFormatEvidence: readonly ProLeagueExactFormatEvidence[];
  }>;

export type ProLeagueMatchupVault = Readonly<{
  vaultId: string;
  displayName: string;
  cores: readonly ProLeagueMatchupCore[];
}>;

export type ProLeagueMatchupLineEdge =
  "favoured" | "contested" | "unfavourable" | "unknown";

export type ProLeagueMatchupLine = ProLeagueMapRace &
  Readonly<{
    mapId: ProLeagueMapId;
    ourRecommendedCoreId: string | null;
    oppositionLikelyCoreId: string | null;
    edge: ProLeagueMatchupLineEdge;
    evidenceWarning: string | null;
  }>;

export type ProLeagueMatchupMapAnalysis = Readonly<{
  mapId: ProLeagueMapId;
  mapName: string;
  selectionRank: number | null;
  mapControl: "ours" | "opposition";
  favouredRaceLines: number;
  contestedRaceLines: number;
  unfavourableRaceLines: number;
  unknownRaceLines: number;
  first16FavouredRaceLines: number;
  first16ContestedRaceLines: number;
  first16UnfavourableRaceLines: number;
  first16UnknownRaceLines: number;
  lines: readonly ProLeagueMatchupLine[];
}>;

export type ProLeagueCoverageStatus =
  "covered" | "competitive" | "best_available_but_weak" | "unproven";

export type ProLeagueCoverageGap = Readonly<{
  raceType: string;
  distanceMetres: number;
  mapIds: readonly ProLeagueMapId[];
  raceLineCount: number;
  maximumGateEntriesPerVault: number;
  status: ProLeagueCoverageStatus;
  bestAvailableCoreIds: readonly string[];
  bestAvailableRostered: boolean;
  discoveryPriority: "high" | "medium" | "maintain";
  rosterAdvice:
    | "retain_strong_coverage"
    | "consider_for_roster"
    | "test_before_roster_lock"
    | "do_not_lock_for_gap_alone";
  guidance: string;
}>;

export type ProLeagueMatchupAnalysis = Readonly<{
  authority: "owner_confirmed";
  raceMode: "bike";
  ourVaultId: string;
  oppositionVaultId: string;
  homeVaultId: string;
  mapControl: "ours" | "opposition";
  gateAllocation: "equal_halves";
  maps: readonly ProLeagueMatchupMapAnalysis[];
  coverageGaps: readonly ProLeagueCoverageGap[];
  substitutionStrategy: Readonly<{
    annualMaximum: 10;
    initialRosterCounting: "unresolved";
    principle: "quality_first_preserve_replacements";
  }>;
}>;

const assessmentPower: Readonly<Record<ProLeagueMatchupAssessment, number>> = {
  winning_range: 3,
  top_three_range: 2,
  outside_top_three_range: 1,
};

function identity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} must not be blank.`);
  return normalized;
}

function raceKey(raceType: string, distanceMetres: number): string {
  return JSON.stringify([raceType.trim().toLowerCase(), distanceMetres]);
}

function usable(profile: ProLeagueExactFormatEvidence): boolean {
  return (
    profile.sampleStatus === "minimally_analytical" &&
    (profile.freshness === "current" || profile.freshness === "ageing")
  );
}

function validateCore(core: ProLeagueMatchupCore): string {
  const coreId = identity(core.coreId, "Pro League matchup Core ID");
  if (coreId !== core.coreId) {
    throw new Error("Pro League matchup Core IDs must be canonical.");
  }
  identity(core.displayName, "Pro League matchup Core name");
  if (
    core.rosterStatus !== "rostered" &&
    core.rosterStatus !== "not_rostered"
  ) {
    throw new Error("Pro League matchup roster status is invalid.");
  }
  if (!Array.isArray(core.exactFormatEvidence)) {
    throw new Error("Pro League exact-format evidence must be an array.");
  }
  for (const profile of core.exactFormatEvidence) {
    identity(profile.raceType, "Pro League race type");
    const observedAt = new Date(profile.dataCurrentThrough);
    if (
      !Number.isSafeInteger(profile.distanceMetres) ||
      profile.distanceMetres <= 0 ||
      !Number.isSafeInteger(profile.raceCount) ||
      profile.raceCount < 0 ||
      !["hypothesis_only", "minimally_analytical"].includes(
        profile.sampleStatus,
      ) ||
      !["current", "ageing", "stale", "unknown"].includes(profile.freshness) ||
      !["winning_range", "top_three_range", "outside_top_three_range"].includes(
        profile.benchmarkAssessment,
      ) ||
      Number.isNaN(observedAt.getTime()) ||
      observedAt.toISOString() !== profile.dataCurrentThrough
    ) {
      throw new Error("Pro League exact-format evidence is invalid.");
    }
  }
  return coreId;
}

type RankedCore = Readonly<{
  core: ProLeagueMatchupCore;
  profile: ProLeagueExactFormatEvidence;
}>;

function rankedCores(
  cores: readonly ProLeagueMatchupCore[],
  race: Pick<ProLeagueMapRace, "raceType" | "distanceMetres">,
  rosterOnly: boolean,
): readonly RankedCore[] {
  const key = raceKey(race.raceType, race.distanceMetres);
  return cores
    .filter((core) => !rosterOnly || core.rosterStatus === "rostered")
    .flatMap((core) => {
      const profiles = core.exactFormatEvidence
        .filter(
          (profile) =>
            usable(profile) &&
            raceKey(profile.raceType, profile.distanceMetres) === key,
        )
        .sort(
          (left, right) =>
            assessmentPower[right.benchmarkAssessment] -
              assessmentPower[left.benchmarkAssessment] ||
            right.raceCount - left.raceCount ||
            right.dataCurrentThrough.localeCompare(left.dataCurrentThrough),
        );
      return profiles[0] === undefined ? [] : [{ core, profile: profiles[0] }];
    })
    .sort(
      (left, right) =>
        assessmentPower[right.profile.benchmarkAssessment] -
          assessmentPower[left.profile.benchmarkAssessment] ||
        right.profile.raceCount - left.profile.raceCount ||
        left.core.coreId.localeCompare(right.core.coreId),
    );
}

function lineEdge(
  ours: RankedCore | undefined,
  opposition: RankedCore | undefined,
): ProLeagueMatchupLineEdge {
  if (ours === undefined || opposition === undefined) return "unknown";
  const difference =
    assessmentPower[ours.profile.benchmarkAssessment] -
    assessmentPower[opposition.profile.benchmarkAssessment];
  if (difference > 0) return "favoured";
  if (difference < 0) return "unfavourable";
  return "contested";
}

function analyseMap(
  map: (typeof proLeagueMaps)[number],
  ours: ProLeagueMatchupVault,
  opposition: ProLeagueMatchupVault,
  mapControl: "ours" | "opposition",
): ProLeagueMatchupMapAnalysis {
  const lines = map.races.map((race): ProLeagueMatchupLine => {
    const ourBest = rankedCores(ours.cores, race, true)[0];
    const oppositionBest = rankedCores(opposition.cores, race, true)[0];
    const edge = lineEdge(ourBest, oppositionBest);
    return {
      ...race,
      mapId: map.mapId,
      ourRecommendedCoreId: ourBest?.core.coreId ?? null,
      oppositionLikelyCoreId: oppositionBest?.core.coreId ?? null,
      edge,
      evidenceWarning:
        edge === "unknown"
          ? "Exact Bike race-type-plus-distance evidence is incomplete for one or both vaults; do not score this line as an advantage."
          : null,
    };
  });
  const count = (edge: ProLeagueMatchupLineEdge) =>
    lines.filter((line) => line.edge === edge).length;
  const first16 = lines.filter(({ raceNumber }) => raceNumber <= 16);
  const first16Count = (edge: ProLeagueMatchupLineEdge) =>
    first16.filter((line) => line.edge === edge).length;
  return {
    mapId: map.mapId,
    mapName: map.name,
    selectionRank: null,
    mapControl,
    favouredRaceLines: count("favoured"),
    contestedRaceLines: count("contested"),
    unfavourableRaceLines: count("unfavourable"),
    unknownRaceLines: count("unknown"),
    first16FavouredRaceLines: first16Count("favoured"),
    first16ContestedRaceLines: first16Count("contested"),
    first16UnfavourableRaceLines: first16Count("unfavourable"),
    first16UnknownRaceLines: first16Count("unknown"),
    lines,
  };
}

function coverageGaps(
  ours: ProLeagueMatchupVault,
): readonly ProLeagueCoverageGap[] {
  const demands = new Map<
    string,
    {
      raceType: string;
      distanceMetres: number;
      mapIds: Set<ProLeagueMapId>;
      raceLineCount: number;
      maximumGateEntriesPerVault: number;
    }
  >();
  for (const map of proLeagueMaps) {
    for (const race of map.races) {
      const key = raceKey(race.raceType, race.distanceMetres);
      const demand = demands.get(key) ?? {
        raceType: race.raceType,
        distanceMetres: race.distanceMetres,
        mapIds: new Set<ProLeagueMapId>(),
        raceLineCount: 0,
        maximumGateEntriesPerVault: 0,
      };
      demand.mapIds.add(map.mapId);
      demand.raceLineCount += 1;
      demand.maximumGateEntriesPerVault = Math.max(
        demand.maximumGateEntriesPerVault,
        race.gateEntriesPerVault,
      );
      demands.set(key, demand);
    }
  }

  return [...demands.values()]
    .map((demand): ProLeagueCoverageGap => {
      const ranked = rankedCores(ours.cores, demand, false);
      const bestPower =
        ranked[0] === undefined
          ? null
          : assessmentPower[ranked[0].profile.benchmarkAssessment];
      const best =
        bestPower === null
          ? []
          : ranked.filter(
              ({ profile }) =>
                assessmentPower[profile.benchmarkAssessment] === bestPower,
            );
      const status: ProLeagueCoverageStatus =
        bestPower === 3
          ? "covered"
          : bestPower === 2
            ? "competitive"
            : bestPower === 1
              ? "best_available_but_weak"
              : "unproven";
      const bestAvailableRostered = best.some(
        ({ core }) => core.rosterStatus === "rostered",
      );
      const weak =
        status === "best_available_but_weak" || status === "unproven";
      const label = `${demand.raceType} at ${demand.distanceMetres}m`;
      return {
        ...demand,
        mapIds: [...demand.mapIds].sort(),
        status,
        bestAvailableCoreIds: best.map(({ core }) => core.coreId),
        bestAvailableRostered,
        discoveryPriority: weak
          ? "high"
          : status === "competitive"
            ? "medium"
            : "maintain",
        rosterAdvice:
          status === "covered"
            ? "retain_strong_coverage"
            : status === "competitive"
              ? "consider_for_roster"
              : status === "best_available_but_weak"
                ? "do_not_lock_for_gap_alone"
                : "test_before_roster_lock",
        guidance:
          status === "best_available_but_weak"
            ? `${label}: the listed Core is the best currently evidenced option, but it remains outside the top-three range. Do not lock it solely to fill this gap. Prioritise efficient Discovery or breeding; if structural rules force inclusion, mark it provisional and a replacement priority.`
            : status === "unproven"
              ? `${label}: no minimally analytical exact-format evidence is available. Test credible candidates or breed for this gap before using a roster place.`
              : status === "competitive"
                ? `${label}: top-three-range evidence exists, but further Discovery may still improve matchup edge and roster depth.`
                : `${label}: winning-range evidence currently covers this demand; retain it unless fresher opposition evidence changes the matchup.`,
      };
    })
    .sort(
      (left, right) =>
        ({ high: 0, medium: 1, maintain: 2 })[left.discoveryPriority] -
          { high: 0, medium: 1, maintain: 2 }[right.discoveryPriority] ||
        right.raceLineCount - left.raceLineCount ||
        left.distanceMetres - right.distanceMetres ||
        left.raceType.localeCompare(right.raceType),
    );
}

export function buildProLeagueMatchupAnalysis(
  input: Readonly<{
    ourVault: ProLeagueMatchupVault;
    oppositionVault: ProLeagueMatchupVault;
    homeVaultId: string;
  }>,
): ProLeagueMatchupAnalysis {
  const ourVaultId = identity(input.ourVault.vaultId, "Our Vault ID");
  const oppositionVaultId = identity(
    input.oppositionVault.vaultId,
    "Opposition Vault ID",
  );
  const homeVaultId = identity(input.homeVaultId, "Home Vault ID");
  if (ourVaultId === oppositionVaultId) {
    throw new Error("A Pro League matchup requires two different Vaults.");
  }
  if (homeVaultId !== ourVaultId && homeVaultId !== oppositionVaultId) {
    throw new Error("The home Vault must be one of the matchup Vaults.");
  }
  for (const vault of [input.ourVault, input.oppositionVault]) {
    const ids = new Set<string>();
    for (const core of vault.cores) {
      const coreId = validateCore(core);
      if (ids.has(coreId)) {
        throw new Error(
          "Pro League matchup Core IDs must be unique per Vault.",
        );
      }
      ids.add(coreId);
    }
  }
  const mapControl = homeVaultId === ourVaultId ? "ours" : "opposition";
  const analysed = proLeagueMaps.map((map) =>
    analyseMap(map, input.ourVault, input.oppositionVault, mapControl),
  );
  const ordered = [...analysed].sort(
    (left, right) =>
      right.first16FavouredRaceLines -
        right.first16UnfavourableRaceLines -
        (left.first16FavouredRaceLines - left.first16UnfavourableRaceLines) ||
      right.favouredRaceLines -
        right.unfavourableRaceLines -
        (left.favouredRaceLines - left.unfavourableRaceLines) ||
      left.first16UnknownRaceLines - right.first16UnknownRaceLines ||
      left.unknownRaceLines - right.unknownRaceLines ||
      left.mapId.localeCompare(right.mapId),
  );
  const rank = new Map(ordered.map((map, index) => [map.mapId, index + 1]));
  return {
    authority: "owner_confirmed",
    raceMode: "bike",
    ourVaultId,
    oppositionVaultId,
    homeVaultId,
    mapControl,
    gateAllocation: "equal_halves",
    maps: analysed.map((map) => ({
      ...map,
      selectionRank: mapControl === "ours" ? rank.get(map.mapId)! : null,
    })),
    coverageGaps: coverageGaps(input.ourVault),
    substitutionStrategy: {
      annualMaximum: proLeagueCurrentRules.maximumSubstitutionsPerYear,
      initialRosterCounting:
        proLeagueCurrentRules.initialRosterCountsAsSubstitutions,
      principle: "quality_first_preserve_replacements",
    },
  };
}
