import {
  attachDiscoveryBenchmarks,
  type DiscoveryExactDistanceBenchmarkEvidence,
} from "@/domain/discovery-benchmark";
import {
  deriveDiscoveryDecisionGuidance,
  type DiscoveryDecisionCandidate,
} from "@/domain/discovery-decision-guidance";
import { discoveryHypothesisIsEligible } from "@/domain/discovery-hypothesis-governance";
import {
  buildDiscoveryProbePlan,
  type DiscoveryProbeCandidateInput,
} from "@/domain/discovery-probe-plan";
import { deriveFreshness } from "@/domain/freshness";
import { tournamentDiscoveryRelevanceForExactDistance } from "@/domain/tournament-candidate-ranking";
import type { CorePerformanceProfileRepository } from "./core-intelligence-workspace-service";
import type {
  DiscoveryBenchmarkPublication,
  DiscoveryBenchmarkRepository,
} from "./neon-discovery-benchmark-repository";
import type { DiscoveryLineageHypothesisRepository } from "./neon-discovery-lineage-hypothesis-repository";
import type { OwnerVaultCatalogueRepository } from "./owner-vault-catalogue-service";
import type { TournamentCandidateRepository } from "./tournament-workspace-service";
import type { ActiveSelectedDnaCoreRaceHistoryReadRepository } from "./neon-active-dna-core-race-history-generation";
import { deriveCorePerformanceProfilesFromAcceptedHistory } from "./search-core-service";

export type DiscoveryAcceptedHistoryCoverage = Readonly<{
  status:
    | "not_used"
    | "ready"
    | "truncated"
    | "source_changed"
    | "missing"
    | "unavailable";
  generationId: string | null;
  ownedCoreCount: number;
  selectedCoreCount: number;
  omittedCoreCount: number;
  acceptedRowCount: number;
  maximumRows: 10_000;
}>;

const noAcceptedHistoryCoverage: DiscoveryAcceptedHistoryCoverage =
  Object.freeze({
    status: "not_used",
    generationId: null,
    ownedCoreCount: 0,
    selectedCoreCount: 0,
    omittedCoreCount: 0,
    acceptedRowCount: 0,
    maximumRows: 10_000,
  });

export type DiscoveryProbeRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listCandidateEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          candidates: readonly DiscoveryProbeCandidateInput[];
          benchmarks: readonly DiscoveryExactDistanceBenchmarkEvidence[];
          publication: DiscoveryBenchmarkPublication | null;
          lastImportedAt: string | null;
          acceptedHistoryCoverage?: DiscoveryAcceptedHistoryCoverage;
        }>
      >;
    }>;

export type DiscoveryWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type DiscoveryWorkspacePageState = Readonly<{
  candidates: readonly DiscoveryDecisionCandidate[];
  lastImportedAt: string | null;
  publication: DiscoveryBenchmarkPublication | null;
  connectionStatus: DiscoveryWorkspaceConnectionStatus;
  acceptedHistoryCoverage: DiscoveryAcceptedHistoryCoverage;
}>;

export const unavailableDiscoveryProbeRepository: DiscoveryProbeRepository =
  Object.freeze({ status: "not_configured" });

export function createDiscoveryProbeRepository(
  input: Readonly<{
    vaultRepository: OwnerVaultCatalogueRepository;
    performanceRepository: CorePerformanceProfileRepository;
    lineageRepository: DiscoveryLineageHypothesisRepository;
    benchmarkRepository: DiscoveryBenchmarkRepository;
    tournamentRepository: TournamentCandidateRepository;
    acceptedHistoryRepository?: ActiveSelectedDnaCoreRaceHistoryReadRepository | null;
    acceptedHistoryNow?: Date;
  }>,
): DiscoveryProbeRepository {
  if (
    input.vaultRepository.status !== "ready" ||
    input.performanceRepository.status !== "ready" ||
    input.lineageRepository.status !== "ready" ||
    input.benchmarkRepository.status !== "ready"
  ) {
    return unavailableDiscoveryProbeRepository;
  }

  const vaultRepository = input.vaultRepository;
  const performanceRepository = input.performanceRepository;
  const lineageRepository = input.lineageRepository;
  const benchmarkRepository = input.benchmarkRepository;
  const tournamentRepository = input.tournamentRepository;
  return {
    status: "ready",
    async listCandidateEvidenceByOwner(ownerId) {
      const [
        ownedCores,
        persistedPerformance,
        lineageHypotheses,
        benchmarks,
        tournamentEvidence,
      ] = await Promise.all([
        vaultRepository.listCoresByOwner(ownerId, {
          scope: "vault",
          query: null,
          element: null,
          coreClass: null,
          sex: null,
          fNumber: null,
        }),
        performanceRepository.listProfilesByOwner(ownerId),
        lineageRepository.listHypothesesByOwner(ownerId),
        benchmarkRepository.listBenchmarksByOwner(ownerId),
        tournamentRepository.status === "ready"
          ? tournamentRepository.listCandidateEvidenceByOwner(ownerId)
          : Promise.resolve({ brackets: [], lastImportedAt: null }),
      ]);
      const ownedById = new Map(
        ownedCores
          .filter((core) => core.inMyVault)
          .map((core) => [core.sourceCoreId, core] as const),
      );

      let performance = persistedPerformance;
      let acceptedHistoryCoverage = noAcceptedHistoryCoverage;
      if (
        performance.profiles.length === 0 &&
        input.acceptedHistoryRepository !== undefined &&
        input.acceptedHistoryRepository !== null
      ) {
        try {
          const selectedCoreIds = [...ownedById.keys()]
            .sort((left, right) =>
              left.localeCompare(right, "en", { numeric: true }),
            )
            .slice(0, 8);
          const generation =
            selectedCoreIds.length === 0
              ? null
              : await input.acceptedHistoryRepository.readActiveGeneration(
                  ownerId,
                );
          if (generation === null) {
            acceptedHistoryCoverage = Object.freeze({
              ...noAcceptedHistoryCoverage,
              status: "missing",
              ownedCoreCount: ownedById.size,
              omittedCoreCount: ownedById.size,
            });
          } else {
            const selected =
              await input.acceptedHistoryRepository.readSelectedCoreRows(
                ownerId,
                {
                  generationId: generation.generationId,
                  observationSetSha256: generation.observationSetSha256,
                  coreIds: selectedCoreIds,
                  maximumRows: 10_000,
                },
              );
            acceptedHistoryCoverage = Object.freeze({
              status: selected.status,
              generationId: generation.generationId,
              ownedCoreCount: ownedById.size,
              selectedCoreCount: selectedCoreIds.length,
              omittedCoreCount: ownedById.size - selectedCoreIds.length,
              acceptedRowCount:
                selected.status === "ready" ? selected.rows.length : 0,
              maximumRows: 10_000,
            });
            if (selected.status === "ready" && selected.rows.length > 0) {
              performance = {
                profiles: deriveCorePerformanceProfilesFromAcceptedHistory(
                  {
                    acceptedHistoryStatus: "connected",
                    acceptedHistoryGeneration: {
                      generationId: generation.generationId,
                      observationSetSha256: generation.observationSetSha256,
                      publishedAt: generation.publishedAt,
                      observationCount: generation.observationCount,
                    },
                    acceptedHistoryRows: selected.rows,
                  },
                  input.acceptedHistoryNow ?? new Date(),
                ),
                lastImportedAt: generation.publishedAt,
                publication: null,
              };
            }
          }
        } catch {
          acceptedHistoryCoverage = Object.freeze({
            ...noAcceptedHistoryCoverage,
            status: "unavailable",
            ownedCoreCount: ownedById.size,
            omittedCoreCount: ownedById.size,
          });
        }
      }

      const tournamentConfigurations = tournamentEvidence.brackets.map(
        ({ mode, eligibleDistancesMetres, discoveryRelevance }) => ({
          mode,
          eligibleDistancesMetres,
          discoveryRelevance,
        }),
      );

      const directCandidates = performance.profiles
        .filter(
          (profile) => ownedById.has(profile.coreId) && profile.raceCount < 10,
        )
        .map((profile): DiscoveryProbeCandidateInput => {
          const core = ownedById.get(profile.coreId)!;
          const star = profile.starProfile;
          return {
            coreId: profile.coreId,
            coreName: core.displayName,
            mode: profile.mode,
            distanceMetres: profile.distance,
            directRaceCount: profile.raceCount,
            directTimeEvidence: {
              bestMilliseconds: profile.elapsedTime.bestMilliseconds,
              medianMilliseconds: profile.elapsedTime.medianMilliseconds,
              meanMilliseconds: profile.elapsedTime.meanMilliseconds,
              standardDeviationMilliseconds:
                profile.elapsedTime.standardDeviationMilliseconds,
            },
            starEvidence:
              star === null
                ? null
                : {
                    completeStarDataRaceCount: star.completeStarDataRaceCount,
                    goldEligibleRaceCount: star.goldEligibleRaceCount,
                    goldAssignmentOpportunityCount:
                      star.goldAssignmentOpportunityCount,
                    goldReceivedCount: star.goldReceivedCount,
                    blueAssignmentOpportunityCount:
                      star.blueAssignmentOpportunityCount,
                    blueReceivedCount: star.blueReceivedCount,
                  },
            lineageRelationship: null,
            lineageResolved: true,
            lineageRaceCount: 0,
            tournamentRelevance: tournamentDiscoveryRelevanceForExactDistance(
              tournamentConfigurations,
              profile.mode,
              profile.distance,
            ),
            maidenState:
              core.meEligible === null
                ? "unknown"
                : core.meEligible
                  ? "eligible"
                  : "not_eligible",
            freshness: profile.freshness,
            dataCurrentThrough: profile.dataCurrentThrough,
          };
        });

      const lineageCandidates = lineageHypotheses
        .filter((hypothesis) => ownedById.has(hypothesis.coreId))
        .filter((hypothesis) =>
          discoveryHypothesisIsEligible({
            relationship: hypothesis.lineageRelationship,
            supportingRaceCount: hypothesis.lineageRaceCount,
          }),
        )
        .map((hypothesis): DiscoveryProbeCandidateInput => ({
          coreId: hypothesis.coreId,
          coreName: hypothesis.coreName,
          mode: hypothesis.mode,
          distanceMetres: hypothesis.distanceMetres,
          directRaceCount: 0,
          directTimeEvidence: null,
          starEvidence: null,
          lineageRelationship: hypothesis.lineageRelationship,
          lineageResolved: true,
          lineageRaceCount: hypothesis.lineageRaceCount,
          tournamentRelevance: tournamentDiscoveryRelevanceForExactDistance(
            tournamentConfigurations,
            hypothesis.mode,
            hypothesis.distanceMetres,
          ),
          maidenState:
            ownedById.get(hypothesis.coreId)!.meEligible === null
              ? "unknown"
              : ownedById.get(hypothesis.coreId)!.meEligible
                ? "eligible"
                : "not_eligible",
          freshness: "stale",
          dataCurrentThrough: hypothesis.dataCurrentThrough,
        }));

      const importTimestamps = [
        performance.lastImportedAt,
        ...lineageHypotheses.map((hypothesis) => hypothesis.lastImportedAt),
      ].filter((value): value is string => value !== null);
      const lastImportedAt =
        importTimestamps.length === 0
          ? null
          : importTimestamps.reduce((latest, value) =>
              Date.parse(value) > Date.parse(latest) ? value : latest,
            );

      return {
        candidates: [...directCandidates, ...lineageCandidates],
        benchmarks: benchmarks.benchmarks,
        publication: benchmarks.publication,
        lastImportedAt,
        acceptedHistoryCoverage,
      };
    },
  };
}

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function canonicalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function validNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Discovery now must be valid.");
  }
  return value;
}

function validatedPublication(
  value: unknown,
  benchmarkCount: number,
  now: Date,
): DiscoveryBenchmarkPublication | null {
  if (value === null) {
    if (benchmarkCount > 0) {
      throw new Error("Discovery benchmark publication is unavailable.");
    }
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Discovery benchmark publication is invalid.");
  }
  const publication = value as Record<string, unknown>;
  const refreshId = publication.refreshId;
  const raceDatasetVersionId = publication.raceDatasetVersionId;
  const sourceVersionSetSha256 = publication.sourceVersionSetSha256;
  const payloadSha256 = publication.payloadSha256;
  const acceptedCount = publication.benchmarkCount;
  const refreshedAt = canonicalTimestamp(
    publication.refreshedAt,
    "Discovery benchmark refresh",
  );
  const publishedAt = canonicalTimestamp(
    publication.publishedAt,
    "Discovery benchmark publication",
  );
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof refreshId !== "string" ||
    !uuidPattern.test(refreshId) ||
    typeof raceDatasetVersionId !== "string" ||
    !uuidPattern.test(raceDatasetVersionId) ||
    typeof sourceVersionSetSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sourceVersionSetSha256) ||
    typeof payloadSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(payloadSha256) ||
    typeof acceptedCount !== "number" ||
    !Number.isSafeInteger(acceptedCount) ||
    acceptedCount !== benchmarkCount ||
    refreshedAt === null ||
    publishedAt === null ||
    Date.parse(refreshedAt) > Date.parse(publishedAt) ||
    Date.parse(publishedAt) > now.getTime()
  ) {
    throw new Error("Discovery benchmark publication is invalid.");
  }
  return {
    refreshId,
    raceDatasetVersionId,
    sourceVersionSetSha256,
    payloadSha256,
    benchmarkCount: acceptedCount,
    refreshedAt,
    publishedAt,
  };
}

function normalizeFreshness(
  candidates: readonly DiscoveryProbeCandidateInput[],
  lastImportedAt: string | null,
  now: Date,
): readonly DiscoveryProbeCandidateInput[] {
  const importedAtMillis =
    lastImportedAt === null ? null : Date.parse(lastImportedAt);
  if (importedAtMillis !== null && importedAtMillis > now.getTime()) {
    throw new Error("Discovery import timestamp cannot be in the future.");
  }

  return candidates.map((candidate) => {
    const dataCurrentThrough = canonicalTimestamp(
      candidate.dataCurrentThrough,
      "Discovery data current through",
    );
    if (dataCurrentThrough !== null) {
      const cutoffMillis = Date.parse(dataCurrentThrough);
      if (
        cutoffMillis > now.getTime() ||
        (importedAtMillis !== null && cutoffMillis > importedAtMillis)
      ) {
        throw new Error(
          "Discovery data cutoff cannot be in the future or follow its import.",
        );
      }
    }

    return {
      ...candidate,
      dataCurrentThrough,
      freshness:
        lastImportedAt === null
          ? "unknown"
          : deriveFreshness(
              dataCurrentThrough === null ? null : new Date(dataCurrentThrough),
              now,
            ),
    };
  });
}

export async function loadDiscoveryWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: DiscoveryProbeRepository;
    now: Date;
  }>,
): Promise<DiscoveryWorkspacePageState> {
  const now = validNow(input.now);
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      candidates: [],
      lastImportedAt: null,
      publication: null,
      connectionStatus: "identity_not_connected",
      acceptedHistoryCoverage: noAcceptedHistoryCoverage,
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Discovery workspace access denied.");
  }
  if (
    typeof input.repository !== "object" ||
    input.repository === null ||
    !["not_configured", "ready"].includes(input.repository.status)
  ) {
    throw new Error("Discovery repository status is invalid.");
  }
  if (input.repository.status === "not_configured") {
    return {
      candidates: [],
      lastImportedAt: null,
      publication: null,
      connectionStatus: "persistence_not_configured",
      acceptedHistoryCoverage: noAcceptedHistoryCoverage,
    };
  }
  if (typeof input.repository.listCandidateEvidenceByOwner !== "function") {
    throw new Error("Discovery repository is invalid.");
  }

  const evidence =
    await input.repository.listCandidateEvidenceByOwner(authenticatedOwnerId);
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !Array.isArray(evidence.candidates) ||
    !Array.isArray(evidence.benchmarks) ||
    !("publication" in evidence)
  ) {
    throw new Error("Discovery evidence is invalid.");
  }
  const lastImportedAt = canonicalTimestamp(
    evidence.lastImportedAt,
    "Discovery import timestamp",
  );
  const publication = validatedPublication(
    evidence.publication,
    evidence.benchmarks.length,
    now,
  );
  if (
    publication !== null &&
    evidence.benchmarks.some(
      (benchmark) =>
        benchmark.refreshedAt !== publication.refreshedAt ||
        Date.parse(benchmark.dataCurrentThrough) >
          Date.parse(publication.refreshedAt),
    )
  ) {
    throw new Error("Discovery benchmark publication is inconsistent.");
  }
  const probePlan = buildDiscoveryProbePlan(
    normalizeFreshness(evidence.candidates, lastImportedAt, now),
  );
  const benchmarkedPlan = attachDiscoveryBenchmarks(
    probePlan,
    evidence.benchmarks,
  );
  return {
    candidates: deriveDiscoveryDecisionGuidance(benchmarkedPlan),
    lastImportedAt,
    publication,
    connectionStatus: "read_model_connected",
    acceptedHistoryCoverage:
      evidence.acceptedHistoryCoverage ?? noAcceptedHistoryCoverage,
  };
}
