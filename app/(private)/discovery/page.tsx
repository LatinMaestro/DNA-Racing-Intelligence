import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonDiscoveryBenchmarkRepositoryFromEnvironment } from "@/lib/neon-discovery-benchmark-repository";
import { neonDiscoveryLineageHypothesisRepositoryFromEnvironment } from "@/lib/neon-discovery-lineage-hypothesis-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import {
  createDiscoveryProbeRepository,
  loadDiscoveryWorkspacePageState,
} from "@/lib/discovery-workspace-service";
import { unavailableTournamentCandidateRepository } from "@/lib/tournament-workspace-service";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage() {
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
  const state = await loadDiscoveryWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: createDiscoveryProbeRepository({
      vaultRepository:
        neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
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
      tournamentRepository: unavailableTournamentCandidateRepository,
    }),
    now: new Date(),
  });

  return (
    <DiscoveryWorkspace
      candidates={state.candidates}
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
    />
  );
}
