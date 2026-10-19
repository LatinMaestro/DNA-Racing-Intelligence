import {
  CoreIntelligenceWorkspace,
  coreIntelligenceEvidenceViews,
  type CoreIntelligenceEvidenceView,
} from "@/components/core-intelligence-workspace";
import { raceModes, type RaceMode } from "@/domain/core-performance";
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

function selectedMode(value: string | string[] | undefined): RaceMode | "all" {
  const selected = Array.isArray(value) ? value[0] : value;
  return raceModes.find((mode) => mode === selected) ?? "all";
}

function selectedDistance(value: string | string[] | undefined): number | null {
  const selected = Array.isArray(value) ? value[0] : value;
  if (selected === undefined || !/^[1-9][0-9]*$/.test(selected)) {
    return null;
  }
  const distance = Number(selected);
  return Number.isSafeInteger(distance) ? distance : null;
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
      publication={state.publication ?? null}
      profiles={state.profiles}
      selectedEvidenceView={evidenceView(params.evidence)}
      selectedMode={selectedMode(params.mode)}
      selectedDistance={selectedDistance(params.distance)}
    />
  );
}
