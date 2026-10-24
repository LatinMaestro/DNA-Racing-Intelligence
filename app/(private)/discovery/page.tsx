import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonDiscoveryBenchmarkRepositoryFromEnvironment } from "@/lib/neon-discovery-benchmark-repository";
import { neonDiscoveryLineageHypothesisRepositoryFromEnvironment } from "@/lib/neon-discovery-lineage-hypothesis-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";
import { neonTournamentConfigurationRepositoryFromEnvironment } from "@/lib/neon-tournament-configuration-repository";
import { neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment } from "@/lib/neon-active-dna-core-race-history-generation";
import { probeModes, type ProbeMode } from "@/domain/discovery-probe-plan";
import type { DiscoveryStudyFilters } from "@/components/discovery-study-workspace";
import {
  createDiscoveryProbeRepository,
  loadDiscoveryWorkspacePageState,
} from "@/lib/discovery-workspace-service";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function studyFilters(
  values: Record<string, string | string[] | undefined>,
): DiscoveryStudyFilters {
  const requestedMode = first(values.mode);
  const mode: ProbeMode = probeModes.includes(requestedMode as ProbeMode)
    ? (requestedMode as ProbeMode)
    : "bike";
  const requestedSquad = first(values.squad);
  const requestedRecommendation = first(values.recommendation);
  const requestedCompletion = first(values.completion);
  const requestedDistance = first(values.distance);
  const parsedDistance = Number(requestedDistance);
  return {
    mode,
    squad: ["member", "not_member"].includes(requestedSquad ?? "")
      ? (requestedSquad as DiscoveryStudyFilters["squad"])
      : "all",
    recommendation: ["preferred", "exploratory_fallback"].includes(
      requestedRecommendation ?? "",
    )
      ? (requestedRecommendation as DiscoveryStudyFilters["recommendation"])
      : "all",
    distanceMetres:
      Number.isSafeInteger(parsedDistance) && parsedDistance > 0
        ? parsedDistance
        : null,
    evidenceBasis:
      first(values.evidence) === "all" ? null : first(values.evidence),
    completion: ["not_started", "in_progress", "complete", "unknown"].includes(
      requestedCompletion ?? "",
    )
      ? (requestedCompletion as DiscoveryStudyFilters["completion"])
      : "all",
    coreStatus: first(values.status) === "all" ? null : first(values.status),
  };
}

export default async function DiscoveryPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const filters = studyFilters(await searchParams);
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const databaseEnvironment = {
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  };
  const now = new Date();
  const state = await loadDiscoveryWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: createDiscoveryProbeRepository({
      vaultRepository:
        ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment(
          databaseEnvironment,
          now.toISOString(),
        ),
      performanceRepository:
        neonCorePerformanceProfileRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      lineageRepository:
        neonDiscoveryLineageHypothesisRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      benchmarkRepository:
        neonDiscoveryBenchmarkRepositoryFromEnvironment(databaseEnvironment),
      tournamentRepository:
        neonTournamentConfigurationRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      acceptedHistoryRepository:
        authenticatedOwnerId === null
          ? null
          : neonActiveDnaCoreRaceHistoryGenerationReadRepositoryFromEnvironment(
              {
                ...databaseEnvironment,
                ownerId: authenticatedOwnerId,
              },
            ),
      acceptedHistoryNow: now,
    }),
    now,
  });

  return (
    <DiscoveryWorkspace
      candidates={state.candidates}
      acceptedHistoryCoverage={state.acceptedHistoryCoverage}
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
      publication={state.publication}
      studyFilters={filters}
    />
  );
}
