import { proLeagueMaps, type ProLeagueMapId } from "@/domain/pro-league-maps";
import {
  normalizeProLeagueOwnerCoreName,
  ownerDistanceDepthRank,
  ownerPlanEntryByName,
  proLeagueOwnerOverAgeingSubstitutionExclusions,
} from "@/domain/pro-league-owner-final-plan";
import type {
  ProLeagueOwnerCommissioningPlan,
  ProLeagueOwnerRaceMapping,
} from "@/domain/pro-league-owner-commissioning-plan";
import {
  auditProLeagueRoster,
  proLeagueCurrentRules,
  proLeagueOwnerRosterStrategy,
} from "@/domain/pro-league-roster";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";

const MAXIMUM_WATCH_CANDIDATES = 10;
const MAXIMUM_ALTERNATIVES_PER_OUTGOING_CORE = 2;
const ADJACENT_DISTANCE_METRES = 200;
const ownerExcludedNames = new Set(
  proLeagueOwnerOverAgeingSubstitutionExclusions.map(
    normalizeProLeagueOwnerCoreName,
  ),
);

export type ProLeagueSubstitutionChangedLine = Readonly<{
  mapId: ProLeagueMapId;
  mapName: string;
  raceNumber: number;
  first16: boolean;
  raceType: string;
  distanceMetres: number;
  removedCoreNames: readonly string[];
  addedCoreNames: readonly string[];
  strengthDirection: "stronger" | "weaker" | "neutral";
}>;

export type ProLeagueSubstitutionScenario = Readonly<{
  incomingCoreId: string;
  incomingCoreName: string;
  outgoingCoreId: string;
  outgoingCoreName: string;
  rosterCompliant: true;
  assignedCoreEntries: number;
  requiredCoreEntries: number;
  allSlotsFilled: boolean;
  changedLineCount: number;
  changedFirst16LineCount: number;
  strongerLineCount: number;
  weakerLineCount: number;
  strongerFirst16LineCount: number;
  weakerFirst16LineCount: number;
  netFirst16Direction: number;
  netAllLineDirection: number;
  qualityRankDelta: number;
  changedLines: readonly ProLeagueSubstitutionChangedLine[];
}>;

export type ProLeagueSubstitutionWatchCandidate = Readonly<{
  coreId: string;
  displayName: string;
  element: string;
  fNumber: number;
  sex: "male" | "female";
  selectionStatus: ProLeagueRosterCandidateScore["selectionStatus"];
  strongestDistances: readonly number[];
  exactFormatCellCount: number;
  acceptedRaceCount: number;
  watchReason:
    "performance_or_map_upgrade" | "coverage_option" | "development_watch";
  recommendedScenario: ProLeagueSubstitutionScenario;
}>;

export type ProLeagueSubstitutionWatch = Readonly<{
  methodology: Readonly<{
    primaryEvidence: "same_bike_race_type_and_exact_distance";
    metrics: "time_speed_consistency_sample_freshness";
    populationBoundary:
      "required_but_currently_gated" | "whole_population_verified";
    first16Priority: true;
    primaryMaps: readonly ["Anchor", "Measure", "Glory"];
    contingencyMap: "Miracles";
    maximumAdjacentDistanceSteps: 1;
    winRateRole: "supporting_only";
    automaticRosterMutationAllowed: false;
  }>;
  candidates: readonly ProLeagueSubstitutionWatchCandidate[];
  holdReasons: readonly (
    "population_benchmark_unavailable" | "bike_ageing_used_unverified"
  )[];
  ageingWatch: Readonly<{
    status: "authority_pending";
    detail: string;
  }>;
}>;

function cellEvidenceTier(cell: ProLeagueCandidateCellScore | null): number {
  if (cell === null) return 0;
  const assessment =
    cell.benchmarkAssessment === "winning_range"
      ? 3
      : cell.benchmarkAssessment === "top_three_range"
        ? 2
        : 1;
  if (cell.evidenceUse === "ranked") return 600 + assessment * 100;
  if (cell.evidenceUse === "hypothesis_only") return 300 + assessment * 50;
  return 100 + assessment * 25;
}

function exactCell(
  candidate: ProLeagueRosterCandidateScore,
  raceType: string,
  distanceMetres: number,
): ProLeagueCandidateCellScore | null {
  return (
    candidate.cells.find(
      (cell) =>
        cell.raceType.toLowerCase() === raceType.toLowerCase() &&
        cell.distanceMetres === distanceMetres,
    ) ?? null
  );
}

function bestDistanceCell(
  candidate: ProLeagueRosterCandidateScore,
  distanceMetres: number,
): ProLeagueCandidateCellScore | null {
  const values = candidate.cells.filter(
    (cell) => cell.distanceMetres === distanceMetres,
  );
  return (
    [...values].sort(
      (left, right) =>
        cellEvidenceTier(right) - cellEvidenceTier(left) ||
        right.first16RaceLineCount - left.first16RaceLineCount ||
        right.raceLineCount - left.raceLineCount ||
        right.raceCount - left.raceCount,
    )[0] ?? null
  );
}

function bestAdjacentCell(
  candidate: ProLeagueRosterCandidateScore,
  distanceMetres: number,
): ProLeagueCandidateCellScore | null {
  const values = candidate.cells.filter(
    (cell) =>
      Math.abs(cell.distanceMetres - distanceMetres) ===
      ADJACENT_DISTANCE_METRES,
  );
  return (
    [...values].sort(
      (left, right) =>
        cellEvidenceTier(right) - cellEvidenceTier(left) ||
        Math.abs(left.distanceMetres - distanceMetres) -
          Math.abs(right.distanceMetres - distanceMetres) ||
        right.raceCount - left.raceCount,
    )[0] ?? null
  );
}

function ownerPrimaryDistances(
  candidate: ProLeagueRosterCandidateScore,
): readonly number[] {
  return (
    ownerPlanEntryByName(candidate.core.displayName)?.primaryDistances ?? []
  );
}

function distanceStrength(
  candidate: ProLeagueRosterCandidateScore,
  distanceMetres: number,
): number {
  const ownerDepthRank = ownerDistanceDepthRank(
    distanceMetres,
    candidate.core.displayName,
  );
  const exact = bestDistanceCell(candidate, distanceMetres);
  const adjacent = bestAdjacentCell(candidate, distanceMetres);
  const primary = ownerPrimaryDistances(candidate);
  const ownerDepthStrength =
    ownerDepthRank === null ? 0 : 10_000 - ownerDepthRank * 100;
  const exactStrength =
    exact === null
      ? 0
      : 8_500 +
        cellEvidenceTier(exact) +
        exact.first16RaceLineCount * 5 +
        Math.min(exact.raceCount, 100);
  const primaryStrength = primary.includes(distanceMetres) ? 8_800 : 0;
  const adjacentStrength =
    adjacent === null
      ? 0
      : 5_500 + cellEvidenceTier(adjacent) + adjacent.first16RaceLineCount * 3;
  const primaryAdjacentStrength = primary.some(
    (distance) =>
      Math.abs(distance - distanceMetres) === ADJACENT_DISTANCE_METRES,
  )
    ? 5_800
    : 0;
  return Math.max(
    ownerDepthStrength,
    exactStrength,
    primaryStrength,
    adjacentStrength,
    primaryAdjacentStrength,
  );
}

function lineStrength(
  candidate: ProLeagueRosterCandidateScore,
  raceType: string,
  distanceMetres: number,
): number {
  const exact = exactCell(candidate, raceType, distanceMetres);
  if (exact !== null) {
    return (
      20_000 +
      cellEvidenceTier(exact) * 10 +
      exact.first16RaceLineCount * 10 +
      exact.medianVersusTopThreeBasisPoints -
      (exact.consistencyVersusTopThreeBasisPoints ?? 10_000) / 10 +
      Math.min(exact.raceCount, 100)
    );
  }
  const adjacentSameType = candidate.cells
    .filter(
      (cell) =>
        cell.raceType.toLowerCase() === raceType.toLowerCase() &&
        Math.abs(cell.distanceMetres - distanceMetres) ===
          ADJACENT_DISTANCE_METRES,
    )
    .sort(
      (left, right) =>
        cellEvidenceTier(right) - cellEvidenceTier(left) ||
        right.raceCount - left.raceCount,
    )[0];
  if (adjacentSameType !== undefined) {
    return 12_000 + cellEvidenceTier(adjacentSameType) * 5;
  }
  return distanceStrength(candidate, distanceMetres);
}

function strongestDistances(
  candidate: ProLeagueRosterCandidateScore,
): readonly number[] {
  const distances = new Set(
    candidate.cells.map(({ distanceMetres }) => distanceMetres),
  );
  for (const distance of ownerPrimaryDistances(candidate))
    distances.add(distance);
  return Object.freeze(
    [...distances]
      .map((distance) => ({
        distance,
        score: distanceStrength(candidate, distance),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.distance - right.distance,
      )
      .slice(0, 3)
      .map(({ distance }) => distance),
  );
}

function lineKey(mapId: ProLeagueMapId, raceNumber: number): string {
  return `${mapId}:${raceNumber}`;
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function compareScenarios(
  left: ProLeagueSubstitutionScenario,
  right: ProLeagueSubstitutionScenario,
): number {
  return (
    right.netFirst16Direction - left.netFirst16Direction ||
    right.netAllLineDirection - left.netAllLineDirection ||
    right.qualityRankDelta - left.qualityRankDelta ||
    left.weakerFirst16LineCount - right.weakerFirst16LineCount ||
    left.weakerLineCount - right.weakerLineCount ||
    left.changedLineCount - right.changedLineCount ||
    left.outgoingCoreName.localeCompare(right.outgoingCoreName)
  );
}

function scenarioForSwap(input: {
  incoming: ProLeagueRosterCandidateScore;
  outgoing: ProLeagueRosterCandidateScore;
  roster: ProLeagueDraftRosterRecommendation;
  ownerPlan: ProLeagueOwnerCommissioningPlan;
  candidateRank: ReadonlyMap<string, number>;
  candidateByName: ReadonlyMap<string, ProLeagueRosterCandidateScore>;
}): ProLeagueSubstitutionScenario | null {
  const currentRosterIds = new Set(
    input.roster.draftRoster?.rosteredCoreIds ?? [],
  );
  if (
    currentRosterIds.size !== 25 ||
    !currentRosterIds.has(input.outgoing.core.coreId) ||
    currentRosterIds.has(input.incoming.core.coreId)
  ) {
    return null;
  }
  currentRosterIds.delete(input.outgoing.core.coreId);
  currentRosterIds.add(input.incoming.core.coreId);
  const scenarioCandidates = input.roster.candidates.filter(({ core }) =>
    currentRosterIds.has(core.coreId),
  );
  if (scenarioCandidates.length !== 25) return null;
  const audit = auditProLeagueRoster(
    scenarioCandidates.map(({ core }) => core),
  );
  if (audit.readiness !== "compliant") return null;

  const baseLines = new Map<string, ProLeagueOwnerRaceMapping>();
  for (const map of input.ownerPlan.maps) {
    for (const line of map.lines) {
      baseLines.set(lineKey(map.mapId, line.raceNumber), line);
    }
  }

  const depthByDistance = new Map<
    number,
    readonly ProLeagueRosterCandidateScore[]
  >();
  for (const distance of [1000, 1200, 1400, 1600, 1800, 2000, 2200]) {
    const ranked = [...scenarioCandidates]
      .map((candidate) => ({
        candidate,
        score: distanceStrength(candidate, distance),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          (input.candidateRank.get(left.candidate.core.coreId) ??
            Number.MAX_SAFE_INTEGER) -
            (input.candidateRank.get(right.candidate.core.coreId) ??
              Number.MAX_SAFE_INTEGER),
      )
      .slice(0, 12)
      .map(({ candidate }) => candidate);
    if (ranked.length < 12) return null;
    depthByDistance.set(distance, Object.freeze(ranked));
  }

  const changedLines: ProLeagueSubstitutionChangedLine[] = [];
  let requiredCoreEntries = 0;
  let assignedCoreEntries = 0;
  let strongerLineCount = 0;
  let weakerLineCount = 0;
  let strongerFirst16LineCount = 0;
  let weakerFirst16LineCount = 0;

  for (const map of proLeagueMaps) {
    for (const race of map.races) {
      const depth = depthByDistance.get(race.distanceMetres);
      if (depth === undefined) return null;
      const assigned = [...depth]
        .sort(
          (left, right) =>
            lineStrength(right, race.raceType, race.distanceMetres) -
              lineStrength(left, race.raceType, race.distanceMetres) ||
            (input.candidateRank.get(left.core.coreId) ??
              Number.MAX_SAFE_INTEGER) -
              (input.candidateRank.get(right.core.coreId) ??
                Number.MAX_SAFE_INTEGER),
        )
        .slice(0, race.gateEntriesPerVault);
      requiredCoreEntries += race.gateEntriesPerVault;
      assignedCoreEntries += assigned.length;
      if (assigned.length !== race.gateEntriesPerVault) return null;

      const base = baseLines.get(lineKey(map.mapId, race.raceNumber));
      if (base === undefined) return null;
      const nextNames = assigned.map(({ core }) => core.displayName);
      if (sameNames(base.coreNames, nextNames)) continue;

      const beforeStrength = base.coreNames.reduce((sum, displayName) => {
        const candidate = input.candidateByName.get(
          normalizeProLeagueOwnerCoreName(displayName),
        );
        return (
          sum +
          (candidate === undefined
            ? 0
            : lineStrength(candidate, race.raceType, race.distanceMetres))
        );
      }, 0);
      const afterStrength = assigned.reduce(
        (sum, candidate) =>
          sum + lineStrength(candidate, race.raceType, race.distanceMetres),
        0,
      );
      const strengthDirection =
        afterStrength > beforeStrength
          ? ("stronger" as const)
          : afterStrength < beforeStrength
            ? ("weaker" as const)
            : ("neutral" as const);
      if (strengthDirection === "stronger") {
        strongerLineCount += 1;
        if (race.raceNumber <= 16) strongerFirst16LineCount += 1;
      }
      if (strengthDirection === "weaker") {
        weakerLineCount += 1;
        if (race.raceNumber <= 16) weakerFirst16LineCount += 1;
      }
      const baseSet = new Set(base.coreNames);
      const nextSet = new Set(nextNames);
      changedLines.push(
        Object.freeze({
          mapId: map.mapId,
          mapName: map.name,
          raceNumber: race.raceNumber,
          first16: race.raceNumber <= 16,
          raceType: race.raceType,
          distanceMetres: race.distanceMetres,
          removedCoreNames: Object.freeze(
            base.coreNames.filter((name) => !nextSet.has(name)),
          ),
          addedCoreNames: Object.freeze(
            nextNames.filter((name) => !baseSet.has(name)),
          ),
          strengthDirection,
        }),
      );
    }
  }

  const incomingRank =
    input.candidateRank.get(input.incoming.core.coreId) ??
    Number.MAX_SAFE_INTEGER;
  const outgoingRank =
    input.candidateRank.get(input.outgoing.core.coreId) ??
    Number.MAX_SAFE_INTEGER;

  return Object.freeze({
    incomingCoreId: input.incoming.core.coreId,
    incomingCoreName: input.incoming.core.displayName,
    outgoingCoreId: input.outgoing.core.coreId,
    outgoingCoreName: input.outgoing.core.displayName,
    rosterCompliant: true as const,
    assignedCoreEntries,
    requiredCoreEntries,
    allSlotsFilled: assignedCoreEntries === requiredCoreEntries,
    changedLineCount: changedLines.length,
    changedFirst16LineCount: changedLines.filter(({ first16 }) => first16)
      .length,
    strongerLineCount,
    weakerLineCount,
    strongerFirst16LineCount,
    weakerFirst16LineCount,
    netFirst16Direction: strongerFirst16LineCount - weakerFirst16LineCount,
    netAllLineDirection: strongerLineCount - weakerLineCount,
    qualityRankDelta: outgoingRank - incomingRank,
    changedLines: Object.freeze(
      changedLines.sort(
        (left, right) =>
          left.mapId.localeCompare(right.mapId) ||
          left.raceNumber - right.raceNumber,
      ),
    ),
  });
}

export function buildProLeagueSubstitutionWatch(
  input: Readonly<{
    roster: ProLeagueDraftRosterRecommendation;
    ownerPlan: ProLeagueOwnerCommissioningPlan;
    populationBenchmarkReady: boolean;
    // Only owner-verified *used* amounts belong here. The API's opaque ageing
    // source value must never be treated as used or remaining by inference.
    verifiedBikeAgeingUsedByCoreId?: ReadonlyMap<string, number>;
  }>,
): ProLeagueSubstitutionWatch {
  if (
    input.roster.draftRoster === null ||
    input.roster.draftRoster.audit.readiness !== "compliant" ||
    input.roster.draftRoster.rosteredCoreIds.length !== 25
  ) {
    throw new Error(
      "Pro League substitution watch requires the compliant final 25-Core roster.",
    );
  }
  const rosteredIds = new Set(input.roster.draftRoster.rosteredCoreIds);
  const candidateRank = new Map(
    input.roster.candidates.map((candidate, index) => [
      candidate.core.coreId,
      index,
    ]),
  );
  const candidateByName = new Map(
    input.roster.candidates.map((candidate) => [
      normalizeProLeagueOwnerCoreName(candidate.core.displayName),
      candidate,
    ]),
  );
  const holdReasons: Array<ProLeagueSubstitutionWatch["holdReasons"][number]> =
    input.populationBenchmarkReady ? [] : ["population_benchmark_unavailable"];
  const eligibleIncoming = input.roster.candidates.filter(
    ({ core, selectionStatus, cells }) => {
      if (rosteredIds.has(core.coreId) || core.coreClass === "Genesis")
        return false;
      if (
        ownerExcludedNames.has(
          normalizeProLeagueOwnerCoreName(core.displayName),
        )
      )
        return false;
      const provenElite = selectionStatus === "winning_range";
      const credibleElitePotential =
        selectionStatus === "top_three_range" &&
        cells.some(
          (cell) =>
            cell.evidenceUse === "ranked" &&
            cell.supportingStars.qualityKnownRaceCount > 0 &&
            (cell.supportingStars.eliteOpponentYellowReceivedCount > 0 ||
              cell.supportingStars.eliteOpponentBlueReceivedCount > 0),
        );
      if (!provenElite && !credibleElitePotential) return false;
      const used = input.verifiedBikeAgeingUsedByCoreId?.get(core.coreId);
      return (
        input.populationBenchmarkReady &&
        used !== undefined &&
        Number.isSafeInteger(used) &&
        used >= 0 &&
        used <=
          proLeagueOwnerRosterStrategy.initialSelectionMaximumBikeAgeingUsed
      );
    },
  );
  if (
    input.verifiedBikeAgeingUsedByCoreId === undefined ||
    input.roster.candidates.some(({ core }) => {
      if (rosteredIds.has(core.coreId)) return false;
      const used = input.verifiedBikeAgeingUsedByCoreId?.get(core.coreId);
      return used === undefined || !Number.isSafeInteger(used) || used < 0;
    })
  ) {
    holdReasons.push("bike_ageing_used_unverified");
  }
  const primaryMaps = new Set(["Anchor", "Measure", "Glory"]);
  const scenarios = eligibleIncoming.flatMap((incoming) =>
    input.roster.candidates
      .filter(({ core }) => rosteredIds.has(core.coreId))
      .map((outgoing) => {
        const scenario = scenarioForSwap({
          incoming,
          outgoing,
          roster: input.roster,
          ownerPlan: input.ownerPlan,
          candidateRank,
          candidateByName,
        });
        return scenario === null ? null : { incoming, scenario };
      })
      .filter(
        (
          value,
        ): value is Readonly<{
          incoming: ProLeagueRosterCandidateScore;
          scenario: ProLeagueSubstitutionScenario;
        }> =>
          value !== null &&
          value.scenario.allSlotsFilled &&
          value.scenario.weakerFirst16LineCount === 0 &&
          value.scenario.changedLines.some(
            (line) =>
              line.first16 &&
              primaryMaps.has(line.mapName) &&
              line.strengthDirection === "stronger" &&
              line.addedCoreNames.includes(incoming.core.displayName),
          ),
      ),
  );
  const watchedIncoming = new Set<string>();
  const alternativesByOutgoing = new Map<string, number>();
  const candidates = scenarios
    .sort(
      (left, right) =>
        compareScenarios(left.scenario, right.scenario) ||
        (candidateRank.get(left.incoming.core.coreId) ??
          Number.MAX_SAFE_INTEGER) -
          (candidateRank.get(right.incoming.core.coreId) ??
            Number.MAX_SAFE_INTEGER),
    )
    .filter(({ incoming, scenario }) => {
      if (
        watchedIncoming.has(incoming.core.coreId) ||
        (alternativesByOutgoing.get(scenario.outgoingCoreId) ?? 0) >=
          MAXIMUM_ALTERNATIVES_PER_OUTGOING_CORE ||
        watchedIncoming.size >= MAXIMUM_WATCH_CANDIDATES
      )
        return false;
      watchedIncoming.add(incoming.core.coreId);
      alternativesByOutgoing.set(
        scenario.outgoingCoreId,
        (alternativesByOutgoing.get(scenario.outgoingCoreId) ?? 0) + 1,
      );
      return true;
    })
    .map(({ incoming, scenario }): ProLeagueSubstitutionWatchCandidate =>
      Object.freeze({
        coreId: incoming.core.coreId,
        displayName: incoming.core.displayName,
        element: incoming.core.element,
        fNumber: incoming.core.fNumber,
        sex: incoming.core.sex,
        selectionStatus: incoming.selectionStatus,
        strongestDistances: strongestDistances(incoming),
        exactFormatCellCount: incoming.qualityVector.exactFormatCells,
        acceptedRaceCount: incoming.qualityVector.acceptedRaceCount,
        watchReason:
          scenario.netFirst16Direction > 0 || scenario.netAllLineDirection > 0
            ? ("performance_or_map_upgrade" as const)
            : scenario.changedLineCount > 0
              ? ("coverage_option" as const)
              : ("development_watch" as const),
        recommendedScenario: scenario,
      }),
    );

  return Object.freeze({
    methodology: Object.freeze({
      primaryEvidence: "same_bike_race_type_and_exact_distance" as const,
      metrics: "time_speed_consistency_sample_freshness" as const,
      populationBoundary: input.populationBenchmarkReady
        ? ("whole_population_verified" as const)
        : ("required_but_currently_gated" as const),
      first16Priority: true as const,
      primaryMaps: Object.freeze(["Anchor", "Measure", "Glory"] as const),
      contingencyMap: "Miracles" as const,
      maximumAdjacentDistanceSteps:
        proLeagueOwnerRosterStrategy.mappingPolicy
          .maximumAdjacentDistanceStepsWithoutDirectEvidence,
      winRateRole: "supporting_only" as const,
      automaticRosterMutationAllowed: false as const,
    }),
    candidates: Object.freeze(candidates),
    holdReasons: Object.freeze(holdReasons),
    ageingWatch: Object.freeze({
      status: "authority_pending" as const,
      detail:
        "The owner requires at most 400 verified Bike ageing used for incoming Cores. The API ageing field's used-versus-remaining meaning and real Pro League ageing increments remain unverified, so an opaque value never qualifies a substitution.",
    }),
  });
}

export const PRO_LEAGUE_SUBSTITUTION_LIMIT =
  proLeagueCurrentRules.maximumSubstitutionsPerYear;
