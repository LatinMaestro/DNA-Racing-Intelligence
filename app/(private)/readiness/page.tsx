import { ReadinessWorkspace } from "@/components/readiness-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadReadinessWorkspacePageState,
  unavailableReadinessAssessmentRepository,
} from "@/lib/readiness-workspace-service";

export const dynamic = "force-dynamic";

export default async function ReadinessPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadReadinessWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableReadinessAssessmentRepository,
    expectedHeadSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    now: new Date(),
  });

  return (
    <ReadinessWorkspace
      assessmentId={state.assessmentId}
      assessedAt={state.assessedAt}
      assessmentVersion={state.assessmentVersion}
      connectionStatus={state.connectionStatus}
      evidenceCurrentThrough={state.evidenceCurrentThrough}
      evidenceFreshness={state.evidenceFreshness}
      exactHeadSha={state.exactHeadSha}
      readiness={state.readiness}
    />
  );
}
