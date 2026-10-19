import { ReadinessWorkspace } from "@/components/readiness-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadReadinessWorkspacePageState } from "@/lib/readiness-workspace-service";
import { neonReadinessAssessmentRepositoryFromEnvironment } from "@/lib/neon-readiness-assessment-repository";
import { neonTournamentHorseScreeningRepositoryFromEnvironment } from "@/lib/neon-tournament-horse-screening-repository";
import { loadTournamentHorseScreeningState } from "@/lib/tournament-horse-screening-service";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
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
  const now = new Date();
  const state = await loadReadinessWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonReadinessAssessmentRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      authenticatedOwnerId,
    }),
    expectedHeadSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    now,
  });
  const horseScreeningState = await loadTournamentHorseScreeningState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository:
      neonTournamentHorseScreeningRepositoryFromEnvironment(
        databaseEnvironment,
      ),
    now,
  });

  return (
    <ReadinessWorkspace
      assessmentId={state.assessmentId}
      assessmentSnapshotSha256={state.assessmentSnapshotSha256}
      assessedAt={state.assessedAt}
      assessmentVersion={state.assessmentVersion}
      connectionStatus={state.connectionStatus}
      evidenceCurrentThrough={state.evidenceCurrentThrough}
      evidenceFreshness={state.evidenceFreshness}
      exactHeadSha={state.exactHeadSha}
      publishedAt={state.publishedAt}
      horseScreeningState={horseScreeningState}
      readiness={state.readiness}
    />
  );
}
