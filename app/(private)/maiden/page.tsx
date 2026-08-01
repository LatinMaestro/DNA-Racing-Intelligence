import { MaidenWorkspace } from "@/components/maiden-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadMaidenWorkspacePageState,
  unavailableMaidenAllocationRepository,
} from "@/lib/maiden-workspace-service";

export const dynamic = "force-dynamic";

export default async function MaidenPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadMaidenWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableMaidenAllocationRepository,
    now: new Date(),
  });

  return (
    <MaidenWorkspace
      allocation={state.allocation}
      connectionStatus={state.connectionStatus}
      lastImportedAt={state.lastImportedAt}
    />
  );
}
