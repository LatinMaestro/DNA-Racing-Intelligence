import { VaultWorkspace } from "@/components/vault-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadVaultWorkspacePageState,
  unavailableVaultRegistryRepository,
} from "@/lib/vault-workspace-service";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadVaultWorkspacePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableVaultRegistryRepository,
    now: new Date(),
  });

  return (
    <VaultWorkspace
      connectionStatus={state.connectionStatus}
      registry={state.registry}
    />
  );
}
