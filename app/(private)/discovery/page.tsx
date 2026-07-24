import { DiscoveryWorkspace } from "@/components/discovery-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadDiscoveryWorkspacePageState,
  unavailableDiscoveryProbeRepository,
} from "@/lib/discovery-workspace-service";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadDiscoveryWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableDiscoveryProbeRepository,
  });

  return (
    <DiscoveryWorkspace
      candidates={state.candidates}
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
    />
  );
}
