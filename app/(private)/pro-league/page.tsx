import { ProLeagueWorkspace } from "@/components/pro-league-workspace";
import { auditProLeagueRoster } from "@/domain/pro-league-roster";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import {
  createProLeaguePreparationRepository,
  loadProLeaguePreparationPageState,
} from "@/lib/pro-league-preparation-service";

export const dynamic = "force-dynamic";

export default async function ProLeaguePage() {
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
  const state = await loadProLeaguePreparationPageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: createProLeaguePreparationRepository({
      vaultRepository:
        neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
      performanceRepository:
        neonCorePerformanceProfileRepositoryFromEnvironment(databaseEnvironment),
    }),
  });

  return (
    <ProLeagueWorkspace
      audit={auditProLeagueRoster([])}
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
      preparation={state.preparation}
    />
  );
}
