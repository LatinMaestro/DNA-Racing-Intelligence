import { LifecycleWorkspace } from "@/components/lifecycle-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadLifecycleWorkspacePageState } from "@/lib/lifecycle-workspace-service";
import { neonLifecycleRankingRepositoryFromEnvironment } from "@/lib/neon-lifecycle-ranking-repository";

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

  return (
    <LifecycleWorkspace
      connectionStatus={state.connectionStatus}
      ranking={state.ranking}
    />
  );
}
