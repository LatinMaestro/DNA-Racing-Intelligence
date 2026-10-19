import {
  acknowledgeTournamentCampaignAction,
  saveTournamentConfigurationAction,
} from "@/app/(private)/tournaments/actions";
import {
  TournamentCampaignActionForm,
  TournamentConfigurationForm,
  type TournamentEditorSelection,
} from "@/components/tournament-configuration-form";
import { Season12TournamentSchedule } from "@/components/season-12-tournament-schedule";
import { TournamentHorseScreeningPanel } from "@/components/tournament-horse-screening-panel";
import { TournamentWorkspace } from "@/components/tournament-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonTournamentConfigurationRepositoryFromEnvironment } from "@/lib/neon-tournament-configuration-repository";
import { neonTournamentHorseScreeningRepositoryFromEnvironment } from "@/lib/neon-tournament-horse-screening-repository";
import { loadTournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";
import { loadTournamentWorkspacePageState } from "@/lib/tournament-workspace-service";

export const dynamic = "force-dynamic";

type TournamentSearchParams = Readonly<{
  tournamentId?: string | string[];
  bracketId?: string | string[];
  create?: string | string[];
}>;

function tournamentEditorSelection(
  params: TournamentSearchParams,
): TournamentEditorSelection {
  const mode = params.create;
  if (mode === "bike" || mode === "car" || mode === "horse") {
    return { kind: "new", mode };
  }
  if (
    typeof params.tournamentId === "string" &&
    typeof params.bracketId === "string"
  ) {
    return {
      kind: "existing",
      tournamentId: params.tournamentId,
      bracketId: params.bracketId,
    };
  }
  return null;
}

export default async function TournamentsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<TournamentSearchParams>;
}>) {
  const editorSelection = tournamentEditorSelection(await searchParams);
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
  const horseScreeningState = await loadTournamentHorseScreeningState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository:
      neonTournamentHorseScreeningRepositoryFromEnvironment(
        databaseEnvironment,
      ),
    now: new Date(),
  });

  return (
    <div className="space-y-8">
      <Season12TournamentSchedule />
      <TournamentConfigurationForm
        brackets={state.brackets}
        connectionStatus={state.connectionStatus}
        saveAction={saveTournamentConfigurationAction}
        selection={editorSelection}
      />
      <TournamentCampaignActionForm
        acknowledgementAction={acknowledgeTournamentCampaignAction}
        brackets={state.brackets}
        connectionStatus={state.connectionStatus}
      />
      <TournamentHorseScreeningPanel state={horseScreeningState} />
      <TournamentWorkspace
        brackets={state.brackets}
        connectionStatus={state.connectionStatus}
        lastImportedAt={state.lastImportedAt}
      />
    </div>
  );
}
