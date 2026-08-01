import { VaultPerformanceWorkspace } from "@/components/vault-performance-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadVaultPerformancePageState,
  unavailableVaultPerformanceSummaryRepository,
} from "@/lib/vault-performance-workspace-service";

export const dynamic = "force-dynamic";

export default async function VaultPerformancePage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadVaultPerformancePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: unavailableVaultPerformanceSummaryRepository,
    now: new Date(),
  });

  return (
    <VaultPerformanceWorkspace
      connectionStatus={state.connectionStatus}
      summary={state.summary}
    />
  );
}
