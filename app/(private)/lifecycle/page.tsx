import { LifecycleWorkspace } from "@/components/lifecycle-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadLifecycleWorkspacePageState,
  unavailableLifecycleRankingRepository,
} from "@/lib/lifecycle-workspace-service";

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
    repository: unavailableLifecycleRankingRepository,
  });

  return (
    <LifecycleWorkspace
      connectionStatus={state.connectionStatus}
      ranking={state.ranking}
    />
  );
}
