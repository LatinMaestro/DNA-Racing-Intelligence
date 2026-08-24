import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { hostedRaceArchiveCoreHistoryRuntime } from "@/lib/hosted-race-archive-core-history-runtime";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { loadSearchCorePageState } from "@/lib/search-core-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(
  params: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = params[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

export default async function SearchCorePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const databaseEnvironment = {
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  };
  const archiveRuntime = hostedRaceArchiveCoreHistoryRuntime({
    environment: {
      authorizedOwnerId: process.env.AUTHORIZED_CLERK_USER_ID,
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
      bucketName: process.env.DNA_R2_BUCKET_NAME,
      r2AccessKeyId: process.env.DNA_R2_ACCESS_KEY_ID,
      r2SecretAccessKey: process.env.DNA_R2_SECRET_ACCESS_KEY,
    },
  });
  const state = await loadSearchCorePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository:
      neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
    performanceRepository:
      neonCorePerformanceProfileRepositoryFromEnvironment(databaseEnvironment),
    archiveHistoryService:
      archiveRuntime.status === "ready" ? archiveRuntime.service : null,
    now: new Date(),
    query: single(params, "q"),
    selectedCoreId: single(params, "coreId"),
  });

  return <SearchCoreWorkspace state={state} />;
}
