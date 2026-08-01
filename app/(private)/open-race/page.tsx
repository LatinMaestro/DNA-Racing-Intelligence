import { OpenRaceWorkspace } from "@/components/open-race-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadOpenRaceWorkspacePageState,
  unavailableOpenRaceWorkspaceRepository,
} from "@/lib/open-race-workspace-service";

export const dynamic = "force-dynamic";

export default async function OpenRacePage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadOpenRaceWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableOpenRaceWorkspaceRepository,
    now: new Date(),
  });

  return (
    <OpenRaceWorkspace
      connectionStatus={state.connectionStatus}
      sessions={state.sessions}
    />
  );
}
