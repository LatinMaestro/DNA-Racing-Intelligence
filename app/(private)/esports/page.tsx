import { EsportsPrepWorkspace } from "@/components/esports-prep-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import {
  createEsportsPrepRepository,
  loadEsportsPrepWorkspacePageState,
} from "@/lib/esports-prep-workspace-service";

export const dynamic = "force-dynamic";

export default async function EsportsPrepPage() {
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
  const state = await loadEsportsPrepWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: createEsportsPrepRepository({
      vaultRepository:
        neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
      performanceRepository:
        neonCorePerformanceProfileRepositoryFromEnvironment(databaseEnvironment),
    }),
  });

  return (
    <EsportsPrepWorkspace
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
      preparation={state.preparation}
    />
  );
}
