import { BreedingWorkspace } from "@/components/breeding-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadBreedingWorkspacePageState,
  unavailableBreedingRankingRepository,
} from "@/lib/breeding-workspace-service";

export const dynamic = "force-dynamic";

export default async function BreedingPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadBreedingWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableBreedingRankingRepository,
  });

  return (
    <BreedingWorkspace
      connectionStatus={state.connectionStatus}
      rankings={state.rankings}
    />
  );
}
