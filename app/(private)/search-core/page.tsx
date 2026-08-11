import { SearchCoreWorkspace } from "@/components/search-core-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
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
  const state = await loadSearchCorePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository:
      neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment),
    performanceRepository:
      neonCorePerformanceProfileRepositoryFromEnvironment(databaseEnvironment),
    now: new Date(),
    query: single(params, "q"),
    selectedCoreId: single(params, "coreId"),
  });

  return <SearchCoreWorkspace state={state} />;
}
