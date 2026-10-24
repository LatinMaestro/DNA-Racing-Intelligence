import { MaidenWorkspace } from "@/components/maiden-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadMaidenWorkspacePageState } from "@/lib/maiden-workspace-service";
import { neonMaidenAllocationRepositoryFromEnvironment } from "@/lib/neon-maiden-allocation-repository";
import { ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment } from "@/lib/owner-vault-api-catalogue-repository";

export const dynamic = "force-dynamic";

export default async function MaidenPage() {
  const now = new Date();
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadMaidenWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonMaidenAllocationRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      authenticatedOwnerId,
    }),
    vaultRepository:
      ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment(
        {
          databaseUrl: process.env.DATABASE_URL,
          databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
          runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
        },
        now.toISOString(),
      ),
    now,
  });

  return (
    <MaidenWorkspace
      allocation={state.allocation}
      connectionStatus={state.connectionStatus}
      eligibilitySummary={state.eligibilitySummary ?? null}
      lastImportedAt={state.lastImportedAt}
      materializedAt={state.materializedAt}
      snapshotSha256={state.snapshotSha256}
      sourceEvidenceSha256={state.sourceEvidenceSha256}
    />
  );
}
