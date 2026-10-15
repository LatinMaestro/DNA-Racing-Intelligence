import { FreshnessStatus } from "@/components/freshness-status";
import { OwnerVaultStatus } from "@/components/owner-vault-status";
import { WorkspaceShortcuts } from "@/components/workspace-shortcuts";
import type {
  HistoricalImportSource,
  ImportWorkspace,
  SourceImportStatus,
} from "@/domain/import-workflow";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { loadDashboardFreshnessPageState } from "@/lib/dashboard-freshness-service";
import { importBatchRepositoryFromEnvironment } from "@/lib/neon-import-batch-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { loadOwnerVaultCataloguePageState } from "@/lib/owner-vault-catalogue-service";

export const dynamic = "force-dynamic";

const readiness = [
  [
    "Recommendations",
    "Dashboard recommendations remain withheld without validated analytical evidence and source coverage.",
  ],
  [
    "Economic reporting",
    "Dashboard totals remain withheld without verified asset-separated ledgers and reconciled coverage.",
  ],
  [
    "Hosting",
    "Private hosting is active. Automatic Git deployments remain disabled.",
  ],
] as const;

function sourceStatus(
  workspace: ImportWorkspace,
  sourceType: HistoricalImportSource,
): SourceImportStatus | null {
  return (
    workspace.sources.find((source) => source.sourceType === sourceType) ?? null
  );
}

export default async function DashboardPage() {
  const authenticatedOwnerId = await authenticatedClerkOwnerId({
    environment: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    },
  });
  const configuredOwnerId = process.env.AUTHORIZED_CLERK_USER_ID ?? null;
  const [vaultState, freshnessState] = await Promise.all([
    loadOwnerVaultCataloguePageState({
      authenticatedOwnerId,
      configuredOwnerId,
      repository: neonOwnerVaultCatalogueRepositoryFromEnvironment({
        databaseUrl: process.env.DATABASE_URL,
        databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
        runtimeRole: process.env.DNA_DATABASE_RUNTIME_ROLE,
      }),
      filters: { scope: "vault" },
    }),
    loadDashboardFreshnessPageState({
      authenticatedOwnerId,
      configuredOwnerId,
      repository: importBatchRepositoryFromEnvironment({
        databaseUrl: process.env.DATABASE_URL,
        databaseOwnerId: process.env.DNA_DATABASE_OWNER_ID,
      }),
      now: new Date(),
    }),
  ]);

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
          Browse your Vault and linked historical evidence workspaces. The
          snapshot dates shown on this Dashboard are available only where a
          source receipt is connected.
        </p>
      </header>
      <WorkspaceShortcuts />
      <div className="grid gap-4 xl:grid-cols-2">
        <OwnerVaultStatus state={vaultState} />
        <FreshnessStatus
          connectionStatus={freshnessState.connectionStatus}
          source="Core"
          status={sourceStatus(freshnessState.workspace, "core_details")}
        />
        <FreshnessStatus
          connectionStatus={freshnessState.connectionStatus}
          source="Race"
          status={sourceStatus(freshnessState.workspace, "race_merge")}
        />
        <FreshnessStatus
          connectionStatus={freshnessState.connectionStatus}
          source="Arena"
          status={sourceStatus(freshnessState.workspace, "current_arena")}
        />
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
