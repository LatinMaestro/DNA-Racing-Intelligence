import { ProLeagueCommissioningPanel } from "@/components/pro-league-commissioning-panel";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import {
  loadHostedProLeagueCommissioningState,
  loadHostedProLeaguePlanPersistenceState,
} from "@/lib/hosted-pro-league-page-runtime";

export const dynamic = "force-dynamic";

export default async function ProLeaguePage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const environment = {
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
  };
  const now = new Date();
  const commissioning = await loadHostedProLeagueCommissioningState({
    authenticatedOwnerId,
    environment,
    now,
  });
  const planPersistence = await loadHostedProLeaguePlanPersistenceState({
    authenticatedOwnerId,
    environment,
    commissioning,
  });

  return (
    <ProLeagueCommissioningPanel
      planPersistence={planPersistence}
      state={commissioning}
    />
  );
}
