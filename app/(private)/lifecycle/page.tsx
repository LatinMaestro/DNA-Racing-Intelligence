import { LifecycleWorkspace } from "@/components/lifecycle-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadLifecycleWorkspacePageState } from "@/lib/lifecycle-workspace-service";
import { neonLifecycleEconomicPersistenceFromEnvironment } from "@/lib/neon-lifecycle-economic-write-repository";
import { neonLifecycleRankingRepositoryFromEnvironment } from "@/lib/neon-lifecycle-ranking-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";

export const dynamic = "force-dynamic";

export default async function LifecyclePage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadLifecycleWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonLifecycleRankingRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      authenticatedOwnerId,
    }),
    now: new Date(),
  });
  const economicPersistence = neonLifecycleEconomicPersistenceFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
  const vaultCatalogue = neonOwnerVaultCatalogueRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });

  return (
    <LifecycleWorkspace
      connectionStatus={state.connectionStatus}
      economicWriteStatus={
        authenticatedOwnerId === null ||
        authenticatedOwnerId !== (process.env.AUTHORIZED_CLERK_USER_ID ?? null)
          ? "identity_not_connected"
          : economicPersistence.status === "ready" &&
              vaultCatalogue.status === "ready"
            ? "ready"
            : "persistence_not_configured"
      }
      publishedAt={state.publishedAt}
      ranking={state.ranking}
      snapshotSha256={state.snapshotSha256}
    />
  );
}
