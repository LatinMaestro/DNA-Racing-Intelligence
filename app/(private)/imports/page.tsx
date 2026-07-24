import { ImportWorkspacePanel } from "@/components/import-workspace";
import {
  loadImportWorkspacePageState,
  unavailableImportBatchRepository,
} from "@/lib/import-workspace-service";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const state = await loadImportWorkspacePageState({
    authenticatedOwnerId: null,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableImportBatchRepository,
    now: new Date(),
  });

  return (
    <ImportWorkspacePanel
      connectionStatus={state.connectionStatus}
      workspace={state.workspace}
    />
  );
}
