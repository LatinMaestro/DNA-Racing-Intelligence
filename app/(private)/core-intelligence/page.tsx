import { CoreIntelligenceWorkspace } from "@/components/core-intelligence-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadCoreIntelligencePageState } from "@/lib/core-intelligence-workspace-service";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";

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
    repository: neonCorePerformanceProfileRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    }),
    now: new Date(),
  });

  return (
    <CoreIntelligenceWorkspace
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
      profiles={state.profiles}
    />
  );
}
