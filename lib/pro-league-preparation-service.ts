import {
  buildProLeaguePreparation,
  type ProLeagueBenchmarkAssessment,
  type ProLeaguePreparation,
  type ProLeaguePreparationCore,
} from "@/domain/pro-league-preparation";
import type { CorePerformanceProfileRepository } from "@/lib/core-intelligence-workspace-service";
import type {
  DiscoveryBenchmarkRepository,
  DiscoveryExactDistanceBenchmark,
} from "@/lib/neon-discovery-benchmark-repository";
import type { CorePayoutFormatProfileRepository } from "@/lib/neon-core-payout-format-profile-repository";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

export type ProLeaguePreparationRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadByOwner: (ownerId: string) => Promise<
        Readonly<{
          cores: readonly ProLeaguePreparationCore[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type ProLeaguePreparationConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type ProLeaguePreparationPageState = Readonly<{
  connectionStatus: ProLeaguePreparationConnectionStatus;
  preparation: ProLeaguePreparation | null;
  lastImportedAt: string | null;
}>;

export const unavailableProLeaguePreparationRepository: ProLeaguePreparationRepository =
  Object.freeze({ status: "not_configured" });

function benchmarkKey(mode: string, distanceMetres: number): string {
  return JSON.stringify([mode, distanceMetres]);
}

function benchmarkAssessment(
  profile: Readonly<{
    elapsedTime: Readonly<{
      bestMilliseconds: number;
      medianMilliseconds: number;
    }>;
  }>,
  benchmark: DiscoveryExactDistanceBenchmark | null,
): ProLeagueBenchmarkAssessment {
  if (benchmark === null) return "not_available";
  if (
    profile.elapsedTime.bestMilliseconds <= benchmark.winningP75Milliseconds ||
    profile.elapsedTime.medianMilliseconds <=
      benchmark.winningMedianMilliseconds
  ) {
    return "winning_range";
  }
  if (
    profile.elapsedTime.bestMilliseconds <= benchmark.topThreeP75Milliseconds ||
    profile.elapsedTime.medianMilliseconds <=
      benchmark.topThreeMedianMilliseconds
  ) {
    return "top_three_range";
  }
  return "outside_top_three_range";
}

export function createProLeaguePreparationRepository(input: {
  vaultRepository: OwnerVaultCatalogueRepository;
  performanceRepository: CorePerformanceProfileRepository;
  benchmarkRepository: DiscoveryBenchmarkRepository;
  payoutFormatRepository: CorePayoutFormatProfileRepository;
}): ProLeaguePreparationRepository {
  if (
    input.vaultRepository.status !== "ready" ||
    input.performanceRepository.status !== "ready" ||
    input.benchmarkRepository.status !== "ready" ||
    input.payoutFormatRepository.status !== "ready"
  ) {
    return unavailableProLeaguePreparationRepository;
  }
  const vault = input.vaultRepository;
  const performance = input.performanceRepository;
  const benchmarks = input.benchmarkRepository;
  const payoutFormats = input.payoutFormatRepository;
  return {
    status: "ready",
    async loadByOwner(ownerId) {
      const [cores, profiles, benchmarkEvidence, formatEvidence] =
        await Promise.all([
          vault.listCoresByOwner(ownerId, {
            scope: "vault",
            query: null,
            element: null,
            coreClass: null,
            sex: null,
            fNumber: null,
          }),
          performance.listProfilesByOwner(ownerId),
          benchmarks.listBenchmarksByOwner(ownerId),
          payoutFormats.listProfilesByOwner(ownerId),
        ]);
      const benchmarkByModeDistance = new Map(
        benchmarkEvidence.map((benchmark) => [
          benchmarkKey(benchmark.mode, benchmark.distanceMetres),
          benchmark,
        ]),
      );
      const performanceByCore = new Map<
        string,
        ProLeaguePreparationCore["performanceProfiles"]
      >();
      for (const profile of profiles.profiles) {
        const benchmark =
          benchmarkByModeDistance.get(
            benchmarkKey(profile.mode, profile.distance),
          ) ?? null;
        performanceByCore.set(profile.coreId, [
          ...(performanceByCore.get(profile.coreId) ?? []),
          {
            mode: profile.mode,
            distanceMetres: profile.distance,
            raceCount: profile.raceCount,
            sampleStatus: profile.sampleStatus,
            freshness: profile.freshness,
            dataCurrentThrough: profile.dataCurrentThrough,
            benchmarkAssessment: benchmarkAssessment(profile, benchmark),
          },
        ]);
      }
      const payoutFormatsByCore = new Map<
        string,
        ProLeaguePreparationCore["payoutFormatProfiles"]
      >();
      for (const profile of formatEvidence.profiles) {
        payoutFormatsByCore.set(profile.coreId, [
          ...(payoutFormatsByCore.get(profile.coreId) ?? []),
          {
            mode: profile.mode,
            payoutFormatKey: profile.payoutFormatKey,
            payoutFormatLabel: profile.payoutFormatLabel,
            raceCount: profile.raceCount,
            winCount: profile.winCount,
            topThreeCount: profile.topThreeCount,
            exactDistanceCount: profile.exactDistanceCount,
            timedRaceCount: profile.timedRaceCount,
            sampleStatus: profile.sampleStatus,
            freshness: profile.freshness,
            dataCurrentThrough: profile.dataCurrentThrough,
          },
        ]);
      }
      return {
        cores: cores
          .filter(({ inMyVault }) => inMyVault)
          .map((core) => ({
            coreId: core.sourceCoreId,
            displayName: core.displayName,
            coreClass: core.coreClass,
            element: core.element,
            sex: core.sex,
            fNumber: core.fNumber,
            performanceProfiles: performanceByCore.get(core.sourceCoreId) ?? [],
            payoutFormatProfiles:
              payoutFormatsByCore.get(core.sourceCoreId) ?? [],
          })),
        lastImportedAt:
          [profiles.lastImportedAt, formatEvidence.lastImportedAt]
            .filter((value): value is string => value !== null)
            .sort()[0] ?? null,
      };
    },
  };
}

function identity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Pro League import timestamp is invalid.");
  }
  return value;
}

export async function loadProLeaguePreparationPageState(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ProLeaguePreparationRepository;
}): Promise<ProLeaguePreparationPageState> {
  const authenticatedOwnerId = identity(input.authenticatedOwnerId);
  const configuredOwnerId = identity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      connectionStatus: "identity_not_connected",
      preparation: null,
      lastImportedAt: null,
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Pro League preparation access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      connectionStatus: "persistence_not_configured",
      preparation: null,
      lastImportedAt: null,
    };
  }
  const evidence = await input.repository.loadByOwner(authenticatedOwnerId);
  return {
    connectionStatus: "read_model_connected",
    preparation: buildProLeaguePreparation(evidence.cores),
    lastImportedAt: timestamp(evidence.lastImportedAt),
  };
}
