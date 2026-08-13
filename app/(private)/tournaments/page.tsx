import {
  acknowledgeTournamentCampaignAction,
  saveTournamentConfigurationAction,
} from "@/app/(private)/tournaments/actions";
import {
  TournamentCampaignActionForm,
  TournamentConfigurationForm,
} from "@/components/tournament-configuration-form";
import { TournamentWorkspace } from "@/components/tournament-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonTournamentConfigurationRepositoryFromEnvironment } from "@/lib/neon-tournament-configuration-repository";
import { loadTournamentWorkspacePageState } from "@/lib/tournament-workspace-service";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const databaseEnvironment = {
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  };
  const state = await loadTournamentWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository:
      neonTournamentConfigurationRepositoryFromEnvironment(databaseEnvironment),
    now: new Date(),
  });

  return (
    <div className="space-y-8">
      <TournamentConfigurationForm
        brackets={state.brackets}
        connectionStatus={state.connectionStatus}
        saveAction={saveTournamentConfigurationAction}
      />
      <TournamentCampaignActionForm
        acknowledgementAction={acknowledgeTournamentCampaignAction}
        brackets={state.brackets}
        connectionStatus={state.connectionStatus}
      />
      <TournamentWorkspace
        brackets={state.brackets}
        connectionStatus={state.connectionStatus}
        lastImportedAt={state.lastImportedAt}
      />
    </div>
  );
}
