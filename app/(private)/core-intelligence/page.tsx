import { CoreIntelligenceWorkspace } from "@/components/core-intelligence-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadCoreIntelligencePageState,
  unavailableCorePerformanceProfileRepository,
} from "@/lib/core-intelligence-workspace-service";

export const dynamic = "force-dynamic";

export default async function CoreIntelligencePage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadCoreIntelligencePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableCorePerformanceProfileRepository,
  });

  return (
    <CoreIntelligenceWorkspace
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
      profiles={state.profiles}
    />
  );
}
