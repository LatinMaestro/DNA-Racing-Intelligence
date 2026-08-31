import {
  CoreIntelligenceWorkspace,
  coreIntelligenceEvidenceViews,
  type CoreIntelligenceEvidenceView,
} from "@/components/core-intelligence-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadCoreIntelligencePageState } from "@/lib/core-intelligence-workspace-service";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function evidenceView(
  value: string | string[] | undefined,
): CoreIntelligenceEvidenceView {
  const selected = Array.isArray(value) ? value[0] : value;
  return (
    coreIntelligenceEvidenceViews.find((view) => view === selected) ??
    "overview"
  );
}

export default async function CoreIntelligencePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
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
      esportsConnectionStatus={state.esportsConnectionStatus}
      esportsLastSyncedAt={state.esportsLastSyncedAt}
      esportsProfiles={state.esportsProfiles}
      lastImportedAt={state.lastImportedAt}
      profiles={state.profiles}
      selectedEvidenceView={evidenceView(params.evidence)}
    />
  );
}
