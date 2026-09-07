import { ApiSyncRateControl } from "@/components/api-sync-rate-control";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadDnaOpenLabSyncRatePageState } from "@/lib/dna-open-lab-sync-rate-policy-service";
import { neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";

export const dynamic = "force-dynamic";

type ApiSyncSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function ApiSyncPage({
  searchParams,
}: Readonly<{ searchParams: ApiSyncSearchParams }>) {
  const params = await searchParams;
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadDnaOpenLabSyncRatePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    }),
    now: new Date(),
  });
  return (
    <ApiSyncRateControl
      result={typeof params.result === "string" ? params.result : null}
      state={state}
    />
  );
}
