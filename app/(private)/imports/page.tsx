import { ImportWorkspacePanel } from "@/components/import-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadImportWorkspacePageState } from "@/lib/import-workspace-service";
import { importBatchRepositoryFromEnvironment } from "@/lib/neon-import-batch-repository";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadImportWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: importBatchRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    }),
    now: new Date(),
  });

  return (
    <ImportWorkspacePanel
      connectionStatus={state.connectionStatus}
      workspace={state.workspace}
    />
  );
}
