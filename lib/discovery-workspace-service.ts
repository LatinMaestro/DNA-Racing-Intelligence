import {
  attachDiscoveryBenchmarks,
  type DiscoveryExactDistanceBenchmarkEvidence,
} from "@/domain/discovery-benchmark";
import {
  deriveDiscoveryDecisionGuidance,
  type DiscoveryDecisionCandidate,
} from "@/domain/discovery-decision-guidance";
import {
  buildDiscoveryProbePlan,
  type DiscoveryProbeCandidateInput,
} from "@/domain/discovery-probe-plan";
import { deriveFreshness } from "@/domain/freshness";
import type { CorePerformanceProfileRepository } from "./core-intelligence-workspace-service";
import type { DiscoveryBenchmarkRepository } from "./neon-discovery-benchmark-repository";
import type { DiscoveryLineageHypothesisRepository } from "./neon-discovery-lineage-hypothesis-repository";
import type { OwnerVaultCatalogueRepository } from "./owner-vault-catalogue-service";

export type DiscoveryProbeRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listCandidateEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          candidates: readonly DiscoveryProbeCandidateInput[];
          benchmarks: readonly DiscoveryExactDistanceBenchmarkEvidence[];
          lastImportedAt: string | null;
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
  connectionStatus: DiscoveryWorkspaceConnectionStatus;
}>;

export const unavailableDiscoveryProbeRepository: DiscoveryProbeRepository =
  Object.freeze({ status: "not_configured" });

export function createDiscoveryProbeRepository(
  input: Readonly<{
    vaultRepository: OwnerVaultCatalogueRepository;
    performanceRepository: CorePerformanceProfileRepository;
    lineageRepository: DiscoveryLineageHypothesisRepository;
    benchmarkRepository: DiscoveryBenchmarkRepository;
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
  return {
    status: "ready",
    async listCandidateEvidenceByOwner(ownerId) {
      const [ownedCores, performance, lineageHypotheses, benchmarks] =
        await Promise.all([
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
        ]);
      const ownedById = new Map(
        ownedCores
          .filter((core) => core.inMyVault)
          .map((core) => [core.sourceCoreId, core] as const),
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
            tournamentRelevance: "none",
            maidenState: core.meEligible ? "eligible" : "not_eligible",
            freshness: profile.freshness,
            dataCurrentThrough: profile.dataCurrentThrough,
          };
        });

      const lineageCandidates = lineageHypotheses.map(
        (hypothesis): DiscoveryProbeCandidateInput => ({
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
          tournamentRelevance: "none",
          maidenState: hypothesis.meEligible ? "eligible" : "not_eligible",
          freshness: "stale",
          dataCurrentThrough: hypothesis.dataCurrentThrough,
        }),
      );

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
        benchmarks,
        lastImportedAt,
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
      connectionStatus: "identity_not_connected",
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
      connectionStatus: "persistence_not_configured",
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
    !Array.isArray(evidence.benchmarks)
  ) {
    throw new Error("Discovery evidence is invalid.");
  }
  const lastImportedAt = canonicalTimestamp(
    evidence.lastImportedAt,
    "Discovery import timestamp",
  );
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
    connectionStatus: "read_model_connected",
  };
}
