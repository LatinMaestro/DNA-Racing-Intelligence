import { ImportWorkspacePanel } from "@/components/import-workspace";
import { loadImportWorkspacePageState } from "@/lib/import-workspace-service";
import { importBatchRepositoryFromEnvironment } from "@/lib/neon-import-batch-repository";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const state = await loadImportWorkspacePageState({
    authenticatedOwnerId: null,
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
