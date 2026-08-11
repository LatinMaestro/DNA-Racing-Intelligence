import { FreshnessStatus } from "@/components/freshness-status";
import { OwnerVaultStatus } from "@/components/owner-vault-status";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { loadOwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

const readiness = [
  [
    "Recommendations",
    "Unavailable until accepted imports and validated analytical evidence are connected.",
  ],
  [
    "Economic reporting",
    "No figures are shown until validated ledger records exist.",
  ],
  [
    "Hosting",
    "Private hosting is active. Automatic Git deployments remain disabled.",
  ],
] as const;

export default async function DashboardPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const vaultState = await loadOwnerVaultCataloguePageState({
    authenticatedOwnerId,
    configuredOwnerId: process.env.AUTHORIZED_CLERK_USER_ID ?? null,
    repository: neonOwnerVaultCatalogueRepositoryFromEnvironment({
      databaseUrl: process.env.DATABASE_URL,
      databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
    }),
    filters: { scope: "vault" },
  });

  return (
    <div className="space-y-8">
      <header className="max-w-4xl">
        <p className="text-sm font-semibold text-[var(--accent)]">
          Private owner workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
          Evidence before recommendations.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-[var(--muted)]">
          The private workspace is online. Recommendations and financial totals
          remain evidence-gated until accepted imports and validated aggregates
          are connected.
        </p>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        <OwnerVaultStatus state={vaultState} />
        <FreshnessStatus source="Core" />
        <FreshnessStatus source="Race" />
        <FreshnessStatus source="Arena" />
      </div>
      <section
        aria-labelledby="readiness-heading"
        className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-6"
      >
        <h2 className="text-xl font-semibold" id="readiness-heading">
          Current operating boundaries
        </h2>
        <dl className="mt-5 grid gap-5 md:grid-cols-3">
          {readiness.map(([term, description]) => (
            <div key={term}>
              <dt className="font-semibold text-[var(--accent)]">{term}</dt>
              <dd className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {description}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
