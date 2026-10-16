import { OpenRaceWorkspace } from "@/components/open-race-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOpenRaceWorkspaceRepositoryFromEnvironment } from "@/lib/neon-open-race-workspace-repository";
import { loadOpenRaceWorkspacePageState } from "@/lib/open-race-workspace-service";

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
    repository: neonOpenRaceWorkspaceRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      authenticatedOwnerId,
    }),
    now: new Date(),
  });

  return (
    <OpenRaceWorkspace
      connectionStatus={state.connectionStatus}
      sessions={state.sessions}
    />
  );
}
