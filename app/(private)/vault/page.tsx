import { OwnerVaultWorkspace } from "@/components/owner-vault-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { loadOwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

export const dynamic = "force-dynamic";

type VaultSearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(
  params: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = params[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

export default async function VaultPage({
  searchParams,
}: Readonly<{ searchParams: VaultSearchParams }>) {
  const params = await searchParams;
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const state = await loadOwnerVaultCataloguePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonOwnerVaultCatalogueRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    }),
    filters: {
      scope: single(params, "scope"),
      query: single(params, "q"),
      element: single(params, "element"),
      coreClass: single(params, "coreClass"),
      sex: single(params, "sex"),
      fNumber: single(params, "fNumber"),
    },
  });

  return <OwnerVaultWorkspace state={state} />;
}
