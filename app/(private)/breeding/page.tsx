import { BreedingWorkspace } from "@/components/breeding-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { evidenceViewFilters } from "@/lib/evidence-view-filters";
import { loadBreedingWorkspacePageState } from "@/lib/breeding-workspace-service";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import { neonBreedingEconomicPersistenceFromEnvironment } from "@/lib/neon-breeding-economic-write-repository";

export const dynamic = "force-dynamic";

export default async function BreedingPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const params = await searchParams;
  const parent = (value: unknown): string =>
    typeof value === "string" && value.trim().length <= 256 ? value.trim() : "";
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
  const economicPersistence = neonBreedingEconomicPersistenceFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });

  return (
    <BreedingWorkspace
      connectionStatus={state.connectionStatus}
      economicWriteStatus={
        authenticatedOwnerId === null ||
        authenticatedOwnerId !== configuredOwnerId
          ? "identity_not_connected"
          : economicPersistence.status === "ready"
            ? "evidence_ready"
            : "persistence_not_configured"
      }
      rankings={state.rankings}
      filters={evidenceViewFilters({
        mode: params.mode,
        distance: params.distance,
      })}
      selectedParents={[parent(params.parent1), parent(params.parent2)]}
    />
  );
}
