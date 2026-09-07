import {
  buildProLeagueDraftLineupRecommendation,
  type ProLeagueDraftLineupRecommendation,
} from "@/domain/pro-league-lineup-recommendation";
import {
  buildProLeagueDiscoveryExperimentQueue,
  type ProLeagueDiscoveryExperimentQueue,
} from "@/domain/pro-league-discovery-experiment-queue";
import {
  buildProLeagueDraftRosterRecommendation,
  type ProLeagueDraftRosterRecommendation,
} from "@/domain/pro-league-roster-recommendation";
import {
  loadActiveProLeagueVaultEvidence,
  type ProLeagueEvidenceReadRepository,
} from "@/lib/pro-league-active-vault-evidence-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";
import {
  invalidProLeagueCurrentCoreState,
  loadProLeagueCurrentCoreState,
  type ProLeagueCurrentCoreState,
} from "@/lib/pro-league-current-core-state-service";
import type { DnaOpenLabSupplementalCoreReadRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import type { DnaOpenLabCurrentRaceReadRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import {
  invalidProLeagueRaceOpportunityState,
  loadProLeagueRaceOpportunities,
  type ProLeagueRaceOpportunityState,
} from "@/lib/pro-league-race-opportunity-service";
import type { BreedingRankingRepository } from "@/lib/breeding-workspace-service";
import {
  loadProLeagueBreedingObjectiveState,
  unavailableProLeagueBreedingObjectiveState,
  type ProLeagueBreedingObjectiveState,
} from "@/lib/pro-league-breeding-objective-service";

const SAFE_OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export type ProLeagueDraftCommissioningEvidenceSummary = Readonly<{
  generationId: string;
  evidenceCutoffAt: string;
  publishedAt: string;
  populationProfileCount: number;
  ownedProfileCount: number;
  unownedProfileCount: number;
  ownedCoreWithoutEvidenceCount: number;
}>;

export type ProLeagueDraftCommissioningState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "active_generation_unavailable"
    | "draft_unavailable"
    | "read_model_connected";
  evidence: ProLeagueDraftCommissioningEvidenceSummary | null;
  roster: ProLeagueDraftRosterRecommendation | null;
  lineup: ProLeagueDraftLineupRecommendation | null;
  currentState?: ProLeagueCurrentCoreState;
  raceOpportunities?: ProLeagueRaceOpportunityState;
  discoveryQueue?: ProLeagueDiscoveryExperimentQueue;
  breedingObjectives?: ProLeagueBreedingObjectiveState;
}>;

function ownerId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (normalized !== value || !SAFE_OWNER_ID.test(normalized)) {
    throw new Error("Pro League commissioning owner identity is invalid.");
  }
  return normalized;
}

function empty(
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "active_generation_unavailable",
): ProLeagueDraftCommissioningState {
  return Object.freeze({
    connectionStatus,
    evidence: null,
    roster: null,
    lineup: null,
  });
}

export async function loadProLeagueDraftCommissioningState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    vaultId: string;
    vaultDisplayName: string;
    rosteredCoreIds: readonly string[];
    vaultRepository: OwnerVaultCatalogueRepository;
    evidenceRepository: ProLeagueEvidenceReadRepository | null;
    currentStateRepository?: DnaOpenLabSupplementalCoreReadRepository | null;
    currentRaceRepository?: DnaOpenLabCurrentRaceReadRepository | null;
    breedingRepository?: BreedingRankingRepository;
    now?: Date;
    pageSize?: number;
    maximumSearchNodes?: number;
  }>,
): Promise<ProLeagueDraftCommissioningState> {
  const authenticatedOwnerId = ownerId(input.authenticatedOwnerId);
  const configuredOwnerId = ownerId(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return empty("identity_not_connected");
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Pro League commissioning access denied.");
  }
  if (
    input.vaultRepository.status !== "ready" ||
    input.evidenceRepository === null
  ) {
    return empty("persistence_not_configured");
  }

  const active = await loadActiveProLeagueVaultEvidence({
    ownerId: authenticatedOwnerId,
    vaultId: input.vaultId,
    vaultDisplayName: input.vaultDisplayName,
    rosteredCoreIds: input.rosteredCoreIds,
    vaultRepository: input.vaultRepository,
    evidenceRepository: input.evidenceRepository,
    ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
  });
  if (active === null) return empty("active_generation_unavailable");

  const evidence = Object.freeze({
    generationId: active.generation.generationId,
    evidenceCutoffAt: active.generation.evidenceCutoffAt,
    publishedAt: active.generation.publishedAt,
    populationProfileCount: active.populationProfileCount,
    ownedProfileCount: active.ownedProfileCount,
    unownedProfileCount: active.unownedProfileCount,
    ownedCoreWithoutEvidenceCount: active.ownedCoreWithoutEvidenceCount,
  });
  const roster = buildProLeagueDraftRosterRecommendation({
    vault: active.vault,
    generation: active.generation,
    rosterVersionId: `draft-roster/${active.generation.generationId}`,
    versionNumber: 1,
    ...(input.maximumSearchNodes === undefined
      ? {}
      : { maximumSearchNodes: input.maximumSearchNodes }),
  });
  if (roster.draftRoster === null) {
    return Object.freeze({
      connectionStatus: "draft_unavailable",
      evidence,
      roster,
      lineup: null,
    });
  }
  const selectedCores = roster.draftRoster.members
    .filter(({ disposition }) => disposition === "rostered")
    .map(({ core }) => ({
      sourceCoreId: core.coreId,
      displayName: core.displayName,
    }));
  const currentState = await loadProLeagueCurrentCoreState({
    ownerId: authenticatedOwnerId,
    selectedCores,
    repository: input.currentStateRepository ?? null,
  }).catch(() => invalidProLeagueCurrentCoreState());
  const priorityGapCount = roster.coverageGaps.filter(
    ({ discoveryPriority }) => discoveryPriority !== "maintain",
  ).length;
  const raceOpportunities = await loadProLeagueRaceOpportunities({
    ownerId: authenticatedOwnerId,
    priorityGapCount,
    repository: input.currentRaceRepository ?? null,
  }).catch(() => invalidProLeagueRaceOpportunityState(priorityGapCount));
  const lineup = buildProLeagueDraftLineupRecommendation({
    roster,
    lineupVersionId: `draft-lineup/${active.generation.generationId}`,
    versionNumber: 1,
  });
  const discoveryQueue = buildProLeagueDiscoveryExperimentQueue(roster);
  const breedingObjectives = await loadProLeagueBreedingObjectiveState({
    authenticatedOwnerId,
    configuredOwnerId,
    roster,
    repository: input.breedingRepository ?? { status: "not_configured" },
    now: input.now ?? new Date(),
  }).catch(() =>
    unavailableProLeagueBreedingObjectiveState(
      "invalid_evidence",
      roster.evidenceCutoffAt,
      priorityGapCount,
    ),
  );
  return Object.freeze({
    connectionStatus: "read_model_connected",
    evidence,
    roster,
    lineup,
    currentState,
    raceOpportunities,
    discoveryQueue,
    breedingObjectives,
  });
}
