import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import {
  buildProLeagueBreedingObjectiveQueue,
  type ProLeagueBreedingObjective,
  type ProLeagueBreedingObjectiveCandidate,
  type ProLeagueBreedingObjectiveQueue,
} from "@/domain/pro-league-breeding-objective";
import type { ProLeagueDraftRosterRecommendation } from "@/domain/pro-league-roster-recommendation";
import {
  loadBreedingWorkspacePageState,
  type BreedingRankingRepository,
} from "@/lib/breeding-workspace-service";

export type PublicProLeagueBreedingCandidate = Readonly<
  Omit<
    ProLeagueBreedingObjectiveCandidate,
    "rankingId" | "pairId" | "parentCoreIds"
  > & { candidateNumber: number }
>;

export type PublicProLeagueBreedingObjective = Readonly<
  Omit<ProLeagueBreedingObjective, "candidates"> & {
    candidates: readonly PublicProLeagueBreedingCandidate[];
  }
>;

export type ProLeagueBreedingObjectiveState = Readonly<{
  status: "persistence_not_configured" | "invalid_evidence" | "connected";
  evidenceCutoffAt: string;
  performanceDataCurrentThrough: string | null;
  arenaDataCurrentThrough: string | null;
  performanceFreshness: FreshnessState;
  arenaFreshness: FreshnessState;
  objectives: readonly PublicProLeagueBreedingObjective[];
  diagnostics: ProLeagueBreedingObjectiveQueue["diagnostics"];
  decisionSupportOnly: true;
  recommendationAllowed: false;
  automaticPairValidationAllowed: false;
  spliceExecutionAllowed: false;
}>;

function earliest(values: readonly (string | null)[]): string | null {
  return (
    values
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null
  );
}

function emptyDiagnostics(priorityGapCount: number) {
  return Object.freeze({
    priorityGapCount,
    researchCandidateCount: 0,
    waitingObjectiveCount: priorityGapCount,
    staleOrUnknownRankingCount: 0,
    nonBikePairRowCount: 0,
  });
}

export function unavailableProLeagueBreedingObjectiveState(
  status: "persistence_not_configured" | "invalid_evidence",
  evidenceCutoffAt: string,
  priorityGapCount: number,
): ProLeagueBreedingObjectiveState {
  return Object.freeze({
    status,
    evidenceCutoffAt,
    performanceDataCurrentThrough: null,
    arenaDataCurrentThrough: null,
    performanceFreshness: "unknown",
    arenaFreshness: "unknown",
    objectives: Object.freeze([]),
    diagnostics: emptyDiagnostics(priorityGapCount),
    decisionSupportOnly: true,
    recommendationAllowed: false,
    automaticPairValidationAllowed: false,
    spliceExecutionAllowed: false,
  });
}

function publicObjective(
  objective: ProLeagueBreedingObjective,
): PublicProLeagueBreedingObjective {
  return Object.freeze({
    objectiveId: objective.objectiveId,
    raceType: objective.raceType,
    distanceMetres: objective.distanceMetres,
    mapIds: objective.mapIds,
    raceLineCount: objective.raceLineCount,
    gapPriority: objective.gapPriority,
    gapStatus: objective.gapStatus,
    status: objective.status,
    candidates: Object.freeze(
      objective.candidates.map(
        (
          {
            source,
            evidenceConfidence,
            predictedOffspringClass,
            predictedOffspringElement,
            predictedOffspringFNumber,
            exceptionalUpsideBasisPoints,
            strongerOrExceptionalBasisPoints,
            vaultFitBasisPoints,
            researchRoles,
            performanceEvidenceScope,
            proLeagueRaceTypeEvidence,
            officialPairValidation,
            officialPairInfo,
            recommendationAllowed,
            spliceExecutionAllowed,
          },
          index,
        ) =>
          Object.freeze({
            candidateNumber: index + 1,
            source,
            evidenceConfidence,
            predictedOffspringClass,
            predictedOffspringElement,
            predictedOffspringFNumber,
            exceptionalUpsideBasisPoints,
            strongerOrExceptionalBasisPoints,
            vaultFitBasisPoints,
            researchRoles,
            performanceEvidenceScope,
            proLeagueRaceTypeEvidence,
            officialPairValidation,
            officialPairInfo,
            recommendationAllowed,
            spliceExecutionAllowed,
          }),
      ),
    ),
    warnings: objective.warnings,
  });
}

export async function loadProLeagueBreedingObjectiveState(
  input: Readonly<{
    authenticatedOwnerId: string;
    configuredOwnerId: string;
    roster: ProLeagueDraftRosterRecommendation;
    repository: BreedingRankingRepository;
    now: Date;
  }>,
): Promise<ProLeagueBreedingObjectiveState> {
  const priorityGapCount = input.roster.coverageGaps.filter(
    ({ discoveryPriority }) => discoveryPriority !== "maintain",
  ).length;
  const workspace = await loadBreedingWorkspacePageState({
    authenticatedOwnerId: input.authenticatedOwnerId,
    configuredOwnerId: input.configuredOwnerId,
    repository: input.repository,
    now: input.now,
  });
  if (workspace.connectionStatus !== "read_model_connected") {
    return unavailableProLeagueBreedingObjectiveState(
      "persistence_not_configured",
      input.roster.evidenceCutoffAt,
      priorityGapCount,
    );
  }
  for (const ranking of workspace.rankings) {
    if (
      ranking.dataCurrentThrough !== null &&
      Date.parse(ranking.dataCurrentThrough) >
        Date.parse(input.roster.evidenceCutoffAt)
    ) {
      throw new Error(
        "Pro League breeding performance evidence exceeds the active generation cutoff.",
      );
    }
  }
  const queue = buildProLeagueBreedingObjectiveQueue(
    input.roster,
    workspace.rankings,
  );
  const performanceDataCurrentThrough = earliest(
    workspace.rankings.map(({ dataCurrentThrough }) => dataCurrentThrough),
  );
  const arenaDataCurrentThrough = earliest(
    workspace.rankings.map(
      ({ arenaDataCurrentThrough }) => arenaDataCurrentThrough,
    ),
  );
  return Object.freeze({
    status: "connected",
    evidenceCutoffAt: queue.evidenceCutoffAt,
    performanceDataCurrentThrough,
    arenaDataCurrentThrough,
    performanceFreshness: deriveFreshness(
      performanceDataCurrentThrough === null
        ? null
        : new Date(performanceDataCurrentThrough),
      input.now,
    ),
    arenaFreshness: deriveFreshness(
      arenaDataCurrentThrough === null
        ? null
        : new Date(arenaDataCurrentThrough),
      input.now,
    ),
    objectives: Object.freeze(queue.objectives.map(publicObjective)),
    diagnostics: queue.diagnostics,
    decisionSupportOnly: true,
    recommendationAllowed: false,
    automaticPairValidationAllowed: false,
    spliceExecutionAllowed: false,
  });
}
