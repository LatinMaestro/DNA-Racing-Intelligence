import { OpenRaceWorkspace } from "@/components/open-race-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOpenRacePredictionRepositoryFromEnvironment } from "@/lib/neon-open-race-prediction-repository";
import { neonOpenRaceWorkspaceRepositoryFromEnvironment } from "@/lib/neon-open-race-workspace-repository";
import { loadOpenRacePredictionPageState } from "@/lib/open-race-prediction-page-service";
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
  const predictionState =
    state.connectionStatus === "read_model_connected"
      ? await loadOpenRacePredictionPageState({
          authenticatedOwnerId,
          configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
          repository: neonOpenRacePredictionRepositoryFromEnvironment({
            databaseUrl: process.env.DATABASE_URL,
            databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
            runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
            authenticatedOwnerId,
          }),
          sessions: state.sessions,
        })
      : ({ connectionStatus: "workspace_unavailable", evidence: [] } as const);

  return (
    <OpenRaceWorkspace
      connectionStatus={state.connectionStatus}
      predictionConnectionStatus={predictionState.connectionStatus}
      predictionEvidence={predictionState.evidence}
      sessions={state.sessions}
    />
  );
}
