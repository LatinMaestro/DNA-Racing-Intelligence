import { ProLeagueCommissioningPanel } from "@/components/pro-league-commissioning-panel";
import { ProLeagueWorkspace } from "@/components/pro-league-workspace";
import { auditProLeagueRoster } from "@/domain/pro-league-roster";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonCorePerformanceProfileRepositoryFromEnvironment } from "@/lib/neon-core-performance-profile-repository";
import { neonCorePayoutFormatProfileRepositoryFromEnvironment } from "@/lib/neon-core-payout-format-profile-repository";
import { neonDiscoveryBenchmarkRepositoryFromEnvironment } from "@/lib/neon-discovery-benchmark-repository";
import {
  neonDnaOpenLabCurrentRaceReadRepositoryFromEnvironment,
  neonDnaOpenLabSupplementalCoreReadRepositoryFromEnvironment,
} from "@/lib/neon-dna-open-lab-sync-publication";
import { neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import { neonProLeagueEvidenceReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-evidence-generation-repository";
import { loadProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";
import {
  createProLeaguePreparationRepository,
  loadProLeaguePreparationPageState,
} from "@/lib/pro-league-preparation-service";

export const dynamic = "force-dynamic";

export default async function ProLeaguePage() {
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
  const configuredOwnerId = process.env.AUTHORIZED_CLERK_USER_ID ?? null;
  const vaultRepository =
    neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment);
  const evidenceRepository = neonProLeagueEvidenceReadRepositoryFromEnvironment(
    {
      ...databaseEnvironment,
      ...(configuredOwnerId === null ? {} : { ownerId: configuredOwnerId }),
    },
  );
  const [state, commissioning] = await Promise.all([
    loadProLeaguePreparationPageState({
      authenticatedOwnerId,
      configuredOwnerId,
      repository: createProLeaguePreparationRepository({
        vaultRepository,
        performanceRepository:
          neonCorePerformanceProfileRepositoryFromEnvironment(
            databaseEnvironment,
          ),
        benchmarkRepository:
          neonDiscoveryBenchmarkRepositoryFromEnvironment(databaseEnvironment),
        payoutFormatRepository:
          neonCorePayoutFormatProfileRepositoryFromEnvironment(
            databaseEnvironment,
          ),
      }),
    }),
    loadProLeagueDraftCommissioningState({
      authenticatedOwnerId,
      configuredOwnerId,
      vaultId: "my-vault",
      vaultDisplayName: "My Vault",
      rosteredCoreIds: [],
      vaultRepository,
      evidenceRepository,
      currentStateRepository:
        neonDnaOpenLabSupplementalCoreReadRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      currentRaceRepository:
        neonDnaOpenLabCurrentRaceReadRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      breedingRepository:
        neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
          ...databaseEnvironment,
          ...(configuredOwnerId === null ? {} : { ownerId: configuredOwnerId }),
        }),
      syncRatePolicyRepository:
        neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment(
          databaseEnvironment,
        ),
      now: new Date(),
    }),
  ]);

  return (
    <ProLeagueWorkspace
      audit={auditProLeagueRoster([])}
      connectionStatus={state.connectionStatus}
      commissioning={<ProLeagueCommissioningPanel state={commissioning} />}
      lastImportedAt={state.lastImportedAt}
      preparation={state.preparation}
    />
  );
}
