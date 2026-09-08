import { BreedingWorkspace } from "@/components/breeding-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadBreedingWorkspacePageState } from "@/lib/breeding-workspace-service";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";

export const dynamic = "force-dynamic";

export default async function BreedingPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const configuredOwnerId = process.env.AUTHORIZED_CLERK_USER_ID ?? null;
  const state = await loadBreedingWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId,
    repository: neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      ...(configuredOwnerId === null ? {} : { ownerId: configuredOwnerId }),
    }),
    now: new Date(),
  });

  return (
    <BreedingWorkspace
      connectionStatus={state.connectionStatus}
      rankings={state.rankings}
    />
  );
}
