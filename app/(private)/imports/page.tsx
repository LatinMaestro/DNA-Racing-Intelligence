import { ImportWorkspacePanel } from "@/components/import-workspace";
import { RaceMergeSourceEvidenceUploader } from "@/components/race-merge-source-evidence-uploader";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadImportWorkspacePageState } from "@/lib/import-workspace-service";
import { importBatchRepositoryFromEnvironment } from "@/lib/neon-import-batch-repository";
import { neonImportRollbackRepositoryFromEnvironment } from "@/lib/neon-import-rollback-repository";
import { hostedImportAggregateRetryRuntime } from "@/lib/hosted-import-aggregate-retry-runtime";

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
  const rollbackRepository = neonImportRollbackRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
  const aggregateRetryCapabilities = hostedImportAggregateRetryRuntime({
    environment: {
      authorizedOwnerId: process.env.AUTHORIZED_CLERK_USER_ID,
      database: {
        databaseUrl: process.env.DATABASE_URL,
        databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
        runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      },
      cloudflare: {
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        queueId: process.env.DNA_IMPORT_QUEUE_ID,
        queueName: process.env.DNA_IMPORT_QUEUE_NAME,
        deadLetterQueueName: process.env.DNA_IMPORT_DEAD_LETTER_QUEUE_NAME,
      },
    },
  });

  return (
    <div className="space-y-8">
      <ImportWorkspacePanel
        connectionStatus={state.connectionStatus}
        rollbackActionStatus={rollbackRepository.status}
        aggregateRetryActionStatus={
          aggregateRetryCapabilities.repository.status === "ready" &&
          aggregateRetryCapabilities.backgroundQueue.status === "ready"
            ? "ready"
            : "not_configured"
        }
        workspace={state.workspace}
      />
      {state.connectionStatus === "read_model_connected" ? (
        <RaceMergeSourceEvidenceUploader />
      ) : null}
    </div>
  );
}
