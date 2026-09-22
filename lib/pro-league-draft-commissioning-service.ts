import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import {
  buildProLeagueDraftLineupRecommendation,
  type ProLeagueDraftLineupRecommendation,
} from "@/domain/pro-league-lineup-recommendation";
import {
  buildProLeagueMapPreparationPlan,
  type ProLeagueMapPreparationPlan,
} from "@/domain/pro-league-map-preparation";
import {
  assessProLeagueCommissioningReadiness,
  type ProLeagueCommissioningReadiness,
} from "@/domain/pro-league-commissioning-readiness";
import {
  buildProLeagueDiscoveryExperimentQueue,
  type ProLeagueDiscoveryExperimentQueue,
} from "@/domain/pro-league-discovery-experiment-queue";
import {
  buildProLeagueDraftRosterRecommendation,
  type ProLeagueDraftRosterRecommendation,
} from "@/domain/pro-league-roster-recommendation";
import {
  buildProLeagueOwnerCommissioningPlan,
  type ProLeagueOwnerCommissioningPlan,
} from "@/domain/pro-league-owner-commissioning-plan";
import {
  buildProLeagueSubstitutionWatch,
  type ProLeagueSubstitutionWatch,
} from "@/domain/pro-league-substitution-watch";
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
import type {
  DnaOpenLabServingOwnedCore,
  NeonDnaOpenLabSyncPublicationRepository,
} from "@/lib/neon-dna-open-lab-sync-publication";
import {
  invalidProLeagueRaceOpportunityState,
  loadProLeagueRaceOpportunities,
  type ProLeagueRaceOpportunityState,
} from "@/lib/pro-league-race-opportunity-service";
import type { BreedingRankingRepository } from "@/lib/breeding-workspace-service";
import {
  loadDnaOpenLabSyncRatePageState,
  type DnaOpenLabSyncRatePageState,
  type DnaOpenLabSyncRatePolicyRepository,
} from "@/lib/dna-open-lab-sync-rate-policy-service";
import {
  loadProLeagueBreedingObjectiveState,
  unavailableProLeagueBreedingObjectiveState,
  type ProLeagueBreedingObjectiveState,
} from "@/lib/pro-league-breeding-objective-service";
import {
  invalidProLeagueSyncHealthState,
  loadProLeagueSyncHealthState,
  type ProLeagueSyncHealthState,
} from "@/lib/pro-league-sync-health-service";
import type { DnaOpenLabSyncHealthReadRepository } from "@/lib/neon-dna-open-lab-sync-publication";
import {
  invalidProLeagueHistoryCoverageState,
  loadProLeagueHistoryCoverageState,
  type ProLeagueHistoryCoverageState,
} from "@/lib/pro-league-history-coverage-service";
import type { DnaOpenLabP5FirstBackfillStatusReadRepository } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import type { ProLeagueRosterVersionRepository } from "@/lib/neon-pro-league-roster-version-repository";
import {
  loadProLeagueSubstitutionLedgerState,
  type ProLeagueSubstitutionLedgerState,
} from "@/lib/pro-league-substitution-ledger-service";

const SAFE_OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

export type ProLeagueDraftCommissioningEvidenceSummary = Readonly<{
  generationId: string;
  evidenceCutoffAt: string;
  publishedAt: string;
  freshness: FreshnessState;
  populationProfileCount: number;
  ownedProfileCount: number;
  unownedProfileCount: number;
  ownedCoreWithoutEvidenceCount: number;
}>;

export type ProLeagueStructuralOwnerPool = Readonly<{
  authority: "complete_daily_generation_owned_core_metadata_only";
  generationId: string;
  dataCurrentThrough: string;
  latestObservedAt: string;
  freshness: FreshnessState;
  coreCount: number;
  namedCoreCount: number;
  femaleCount: number;
  aboveF15Count: number;
  f5OrBelowCount: number;
  f10OrBelowCount: number;
  elements: readonly Readonly<{
    element: "Metal" | "Fire" | "Earth" | "Water";
    coreCount: number;
    genesisCount: number;
  }>[];
  performanceSelectionStatus: "held_without_exact_format_elapsed_time_evidence";
  rosterPublished: false;
  mapAssignmentsPublished: false;
  automaticActionAllowed: false;
}>;

export type ProLeagueDraftCommissioningState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "active_generation_unavailable"
    | "structural_pool_connected"
    | "draft_unavailable"
    | "read_model_connected";
  structuralPool?: ProLeagueStructuralOwnerPool;
  evidence: ProLeagueDraftCommissioningEvidenceSummary | null;
  roster: ProLeagueDraftRosterRecommendation | null;
  lineup: ProLeagueDraftLineupRecommendation | null;
  mapPreparation?: ProLeagueMapPreparationPlan;
  readiness?: ProLeagueCommissioningReadiness;
  currentState?: ProLeagueCurrentCoreState;
  raceOpportunities?: ProLeagueRaceOpportunityState;
  discoveryQueue?: ProLeagueDiscoveryExperimentQueue;
  breedingObjectives?: ProLeagueBreedingObjectiveState;
  syncRatePolicy?: DnaOpenLabSyncRatePageState;
  syncHealth?: ProLeagueSyncHealthState;
  historyCoverage?: ProLeagueHistoryCoverageState;
  ownerPlan?: ProLeagueOwnerCommissioningPlan;
  substitutionWatch?: ProLeagueSubstitutionWatch;
  substitutionLedger?: ProLeagueSubstitutionLedgerState;
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

function structuralTimestamp(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Pro League structural Core observation time is invalid.");
  }
  return parsed.getTime();
}

function structuralOwnerPool(
  cores: readonly DnaOpenLabServingOwnedCore[],
  now: Date,
): ProLeagueStructuralOwnerPool | null {
  if (cores.length === 0) return null;
  if (cores.length > 500) {
    throw new Error("Pro League structural Core pool exceeds its safe bound.");
  }
  const generationId = cores[0]!.generationId;
  const ids = new Set<string>();
  const observed = cores.map((core) => {
    if (core.generationId !== generationId) {
      throw new Error("Pro League structural Core generations do not align.");
    }
    if (ids.has(core.canonical.sourceCoreId)) {
      throw new Error("Pro League structural Core pool repeats an identity.");
    }
    ids.add(core.canonical.sourceCoreId);
    return structuralTimestamp(core.observedAt);
  });
  const dataCurrentThrough = new Date(Math.min(...observed)).toISOString();
  const latestObservedAt = new Date(Math.max(...observed)).toISOString();
  const elements = (["Metal", "Fire", "Earth", "Water"] as const).map(
    (element) => {
      const matching = cores.filter(
        ({ canonical }) => canonical.element === element,
      );
      return Object.freeze({
        element,
        coreCount: matching.length,
        genesisCount: matching.filter(
          ({ canonical }) => canonical.coreClass === "Genesis",
        ).length,
      });
    },
  );
  return Object.freeze({
    authority: "complete_daily_generation_owned_core_metadata_only",
    generationId,
    dataCurrentThrough,
    latestObservedAt,
    freshness: deriveFreshness(new Date(dataCurrentThrough), now),
    coreCount: cores.length,
    namedCoreCount: cores.filter(
      ({ canonical }) => canonical.displayName.trim() !== "",
    ).length,
    femaleCount: cores.filter(({ canonical }) => canonical.sex === "female")
      .length,
    aboveF15Count: cores.filter(({ canonical }) => canonical.fNumber > 15)
      .length,
    f5OrBelowCount: cores.filter(({ canonical }) => canonical.fNumber <= 5)
      .length,
    f10OrBelowCount: cores.filter(({ canonical }) => canonical.fNumber <= 10)
      .length,
    elements: Object.freeze(elements),
    performanceSelectionStatus:
      "held_without_exact_format_elapsed_time_evidence",
    rosterPublished: false,
    mapAssignmentsPublished: false,
    automaticActionAllowed: false,
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
    ownedCoreRepository?: Pick<
      NeonDnaOpenLabSyncPublicationRepository,
      "readServingOwnedCores"
    > | null;
    currentStateRepository?: DnaOpenLabSupplementalCoreReadRepository | null;
    currentRaceRepository?: DnaOpenLabCurrentRaceReadRepository | null;
    breedingRepository?: BreedingRankingRepository;
    syncRatePolicyRepository?: DnaOpenLabSyncRatePolicyRepository;
    syncHealthRepository?: DnaOpenLabSyncHealthReadRepository | null;
    historyCoverageRepository?: DnaOpenLabP5FirstBackfillStatusReadRepository | null;
    rosterVersionRepository?: Pick<
      ProLeagueRosterVersionRepository,
      "listSubstitutions"
    > | null;
    substitutionSeasonYear?: number;
    now?: Date;
    pageSize?: number;
    maximumSearchNodes?: number;
    useOwnerFinalPlan?: boolean;
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
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Pro League commissioning freshness time is invalid.");
  }

  const servingOwnedCores =
    input.ownedCoreRepository == null
      ? null
      : await input.ownedCoreRepository
          .readServingOwnedCores({ ownerId: authenticatedOwnerId })
          .catch(() => null);
  const structuralPool =
    servingOwnedCores === null
      ? null
      : structuralOwnerPool(servingOwnedCores, now);
  const exactEvidenceConfigured =
    input.evidenceRepository !== null &&
    ((servingOwnedCores?.length ?? 0) > 0 ||
      input.vaultRepository.status === "ready");
  const active = exactEvidenceConfigured
    ? await loadActiveProLeagueVaultEvidence({
        ownerId: authenticatedOwnerId,
        vaultId: input.vaultId,
        vaultDisplayName: input.vaultDisplayName,
        rosteredCoreIds: input.rosteredCoreIds,
        vaultRepository: input.vaultRepository,
        ...(servingOwnedCores === null || servingOwnedCores.length === 0
          ? {}
          : {
              ownedCores: servingOwnedCores.map(({ canonical }) => ({
                sourceCoreId: canonical.sourceCoreId,
                displayName: canonical.displayName,
                coreClass: canonical.coreClass,
                element: canonical.element,
                fNumber: canonical.fNumber,
                sex: canonical.sex,
                inMyVault: true,
              })),
            }),
        evidenceRepository: input.evidenceRepository!,
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
      })
    : null;
  if (active === null && structuralPool !== null) {
    return Object.freeze({
      connectionStatus: "structural_pool_connected",
      structuralPool,
      evidence: null,
      roster: null,
      lineup: null,
    });
  }
  if (!exactEvidenceConfigured) return empty("persistence_not_configured");
  if (active === null) return empty("active_generation_unavailable");

  const evidence = Object.freeze({
    generationId: active.generation.generationId,
    evidenceCutoffAt: active.generation.evidenceCutoffAt,
    publishedAt: active.generation.publishedAt,
    freshness: deriveFreshness(
      new Date(active.generation.evidenceCutoffAt),
      now,
    ),
    populationProfileCount: active.populationProfileCount,
    ownedProfileCount: active.ownedProfileCount,
    unownedProfileCount: active.unownedProfileCount,
    ownedCoreWithoutEvidenceCount: active.ownedCoreWithoutEvidenceCount,
  });
  const populationBenchmarkReady =
    active.generation.sourceKind === "race_dataset_version" &&
    evidence.unownedProfileCount > 0;
  const populationBenchmarkDetail =
    active.generation.sourceKind === "core_history_generation"
      ? "Current API exact-format evidence is derived from owner Core history only. It does not provide whole-DNA-population elapsed-time profiles, so population-relative roster and mapping validation remains provisional."
      : evidence.unownedProfileCount > 0
        ? `Population evidence includes ${evidence.unownedProfileCount} unowned exact-format profiles for comparison.`
        : "The active population evidence contains no unowned exact-format profiles, so whole-population comparison is unavailable.";

  const roster = buildProLeagueDraftRosterRecommendation({
    vault: active.vault,
    generation: active.generation,
    rosterVersionId: `draft-roster/${active.generation.generationId}`,
    versionNumber: 1,
    useOwnerFinalPlan: input.useOwnerFinalPlan === true,
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
    now,
  }).catch(() => invalidProLeagueCurrentCoreState());
  const priorityGapCount = roster.coverageGaps.filter(
    ({ discoveryPriority }) => discoveryPriority !== "maintain",
  ).length;
  const raceOpportunities = await loadProLeagueRaceOpportunities({
    ownerId: authenticatedOwnerId,
    priorityGapCount,
    repository: input.currentRaceRepository ?? null,
    now,
  }).catch(() => invalidProLeagueRaceOpportunityState(priorityGapCount));
  const ownerPlan =
    input.useOwnerFinalPlan === true
      ? buildProLeagueOwnerCommissioningPlan(roster)
      : undefined;
  const substitutionLedger = await loadProLeagueSubstitutionLedgerState({
    ownerId: authenticatedOwnerId,
    seasonYear: input.substitutionSeasonYear ?? now.getUTCFullYear(),
    repository: input.rosterVersionRepository ?? null,
  });
  const substitutionWatch =
    ownerPlan === undefined
      ? undefined
      : buildProLeagueSubstitutionWatch({ roster, ownerPlan });
  const lineup = buildProLeagueDraftLineupRecommendation({
    roster,
    lineupVersionId: `draft-lineup/${active.generation.generationId}`,
    versionNumber: 1,
  });
  const mapPreparation = buildProLeagueMapPreparationPlan(lineup);
  const discoveryQueue = buildProLeagueDiscoveryExperimentQueue(roster);
  const breedingObjectives = await loadProLeagueBreedingObjectiveState({
    authenticatedOwnerId,
    configuredOwnerId,
    roster,
    repository: input.breedingRepository ?? { status: "not_configured" },
    now,
  }).catch(() =>
    unavailableProLeagueBreedingObjectiveState(
      "invalid_evidence",
      roster.evidenceCutoffAt,
      priorityGapCount,
    ),
  );
  const syncRatePolicy = await loadDnaOpenLabSyncRatePageState({
    authenticatedOwnerId,
    configuredOwnerId,
    repository: input.syncRatePolicyRepository ?? { status: "not_configured" },
    now,
  });
  const syncHealth = await loadProLeagueSyncHealthState({
    authenticatedOwnerId,
    configuredOwnerId,
    repository: input.syncHealthRepository ?? null,
    now,
  }).catch(() => invalidProLeagueSyncHealthState());
  const historyCoverage = await loadProLeagueHistoryCoverageState({
    authenticatedOwnerId,
    configuredOwnerId,
    repository: input.historyCoverageRepository ?? null,
    now,
  }).catch(() => invalidProLeagueHistoryCoverageState());
  const cutoffs = [
    roster.evidenceCutoffAt,
    lineup.evidenceCutoffAt,
    mapPreparation.evidenceCutoffAt,
    discoveryQueue.evidenceCutoffAt,
    breedingObjectives.evidenceCutoffAt,
  ];
  const rosteredMembers = roster.draftRoster.members.filter(
    ({ disposition }) => disposition === "rostered",
  );
  const readiness = assessProLeagueCommissioningReadiness({
    activeEvidence: true,
    populationBenchmarkReady,
    populationBenchmarkDetail,
    populationProfileCount: evidence.populationProfileCount,
    ownedProfileCount: evidence.ownedProfileCount,
    ownedCoreWithoutEvidenceCount: evidence.ownedCoreWithoutEvidenceCount,
    generationCutoffsConsistent: cutoffs.every(
      (cutoff) => cutoff === evidence.evidenceCutoffAt,
    ),
    rosterAvailable: true,
    rosterCompliant: roster.draftRoster.audit.readiness === "compliant",
    rosteredCoreCount: rosteredMembers.length,
    namedRosteredCoreCount: rosteredMembers.filter(
      ({ core }) => core.displayName.trim() !== "",
    ).length,
    lineupAvailable: true,
    mapCount: lineup.maps.length,
    lineCount: lineup.totals.lineCount,
    first16LineCount: lineup.totals.first16LineCount,
    mapPreparationAvailable: true,
    mapPreparationCount: mapPreparation.assessments.length,
    currentCoreStateConnected: currentState.status === "connected",
    currentCoreCount: currentState.cores.length,
    historicalEvidenceFreshness: evidence.freshness,
    currentCoreFreshness: currentState.freshness,
    openRaceFreshness: raceOpportunities.freshness,
    breedingPerformanceFreshness: breedingObjectives.performanceFreshness,
    breedingArenaFreshness: breedingObjectives.arenaFreshness,
    apiRatePolicyConnected: syncRatePolicy.connectionStatus === "connected",
    effectiveRequestsPerMinute:
      syncRatePolicy.policy.effectiveRequestsPerMinute,
    apiRateFallbackActive: syncRatePolicy.policy.fallbackReason !== null,
    lastProviderLimit: syncRatePolicy.policy.lastProviderLimit,
    apiSyncHealthConnected: syncHealth.connectionStatus === "connected",
    apiSyncStatus: syncHealth.syncStatus,
    lastGoodCurrentStateAvailable: syncHealth.lastGood !== null,
    discoveryQueueAvailable: true,
    discoveryExperimentCount: discoveryQueue.experiments.length,
    openRaceStateConnected: raceOpportunities.status === "connected",
    exactOpenRaceGapMatchingAvailable:
      raceOpportunities.exactGapMatchingAvailable,
    breedingResearchConnected: breedingObjectives.status === "connected",
    breedingObjectiveCount: breedingObjectives.objectives.length,
    substitutionLedgerResolved: substitutionLedger.status === "connected",
    opponentExactFormatEvidenceAvailable: false,
    everyAutomaticOrGameActionDisabled:
      !mapPreparation.matchActionAllowed &&
      !discoveryQueue.automaticRaceEntryAllowed &&
      !discoveryQueue.automaticRosterMutationAllowed &&
      !raceOpportunities.raceEntryAllowed &&
      !breedingObjectives.recommendationAllowed &&
      !breedingObjectives.automaticPairValidationAllowed &&
      !breedingObjectives.spliceExecutionAllowed,
  });
  return Object.freeze({
    connectionStatus: "read_model_connected",
    evidence,
    roster,
    lineup,
    ...(ownerPlan === undefined ? {} : { ownerPlan }),
    ...(substitutionWatch === undefined ? {} : { substitutionWatch }),
    substitutionLedger,
    mapPreparation,
    readiness,
    currentState,
    raceOpportunities,
    discoveryQueue,
    breedingObjectives,
    syncRatePolicy,
    syncHealth,
    historyCoverage,
  });
}
