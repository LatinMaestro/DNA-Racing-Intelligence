import { VaultWorkspace } from "@/components/vault-workspace";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { loadOwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

export const dynamic = "force-dynamic";

type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function first(value: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VaultPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const params = await searchParams;
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const repository = neonOwnerVaultCatalogueRepositoryFromEnvironment({
    databaseUrl: process.env.DATABASE_URL,
    databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
    runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
  });
  const state = await loadOwnerVaultCataloguePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository,
    filters: {
      scope: "vault",
      query: first(params.query),
      element: first(params.element),
      coreClass: first(params.coreClass),
      sex: first(params.sex),
      fNumber: first(params.fNumber),
    },
  });

  return <VaultWorkspace state={state} />;
}
