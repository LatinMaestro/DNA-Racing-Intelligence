import { MaidenWorkspace } from "@/components/maiden-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadMaidenWorkspacePageState } from "@/lib/maiden-workspace-service";
import { neonMaidenAllocationRepositoryFromEnvironment } from "@/lib/neon-maiden-allocation-repository";

export const dynamic = "force-dynamic";

export default async function MaidenPage() {
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
    now: new Date(),
  });

  return (
    <MaidenWorkspace
      allocation={state.allocation}
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
      materializedAt={state.materializedAt}
      snapshotSha256={state.snapshotSha256}
      sourceEvidenceSha256={state.sourceEvidenceSha256}
    />
  );
}
