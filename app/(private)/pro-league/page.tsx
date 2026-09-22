import { ProLeagueCommissioningPanel } from "@/components/pro-league-commissioning-panel";
import { authenticatedClerkOwnerId } from "@/lib/clerk-owner-session";
import { neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-publication";
import { neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";
import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { neonDnaOpenLabP5FirstBackfillStatusReadRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import { neonProLeagueEvidenceReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-evidence-generation-repository";
import { createNeonProLeagueRosterVersionRepository } from "@/lib/neon-pro-league-roster-version-repository";
import { loadProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

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
  const now = new Date();
  const combinedServingRepository =
    neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment({
      ...databaseEnvironment,
      validatedAt: now.toISOString(),
    });
  const vaultRepository =
    neonOwnerVaultCatalogueRepositoryFromEnvironment(databaseEnvironment);
  const evidenceRepository = neonProLeagueEvidenceReadRepositoryFromEnvironment(
    {
      ...databaseEnvironment,
      ...(configuredOwnerId === null ? {} : { ownerId: configuredOwnerId }),
    },
  );
  const rosterVersionRepository =
    configuredOwnerId !== null &&
    databaseEnvironment.databaseUrl !== undefined &&
    databaseEnvironment.databaseUrl.trim() !== "" &&
    databaseEnvironment.databaseOwnerId !== undefined &&
    databaseEnvironment.databaseOwnerId.trim() !== ""
      ? createNeonProLeagueRosterVersionRepository({
          databaseUrl: databaseEnvironment.databaseUrl,
          databaseOwnerId: databaseEnvironment.databaseOwnerId,
          ownerId: configuredOwnerId,
          runtimeRole:
            databaseEnvironment.runtimeRole?.trim() || "dna_app_runtime",
        })
      : null;
  const commissioning = await loadProLeagueDraftCommissioningState({
    authenticatedOwnerId,
    configuredOwnerId,
    vaultId: "my-vault",
    vaultDisplayName: "My Vault",
    rosteredCoreIds: [],
    useOwnerFinalPlan: true,
    vaultRepository,
    evidenceRepository,
    ownedCoreRepository: combinedServingRepository,
    currentStateRepository: combinedServingRepository,
    currentRaceRepository: combinedServingRepository,
    breedingRepository:
      neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
        ...databaseEnvironment,
        ...(configuredOwnerId === null ? {} : { ownerId: configuredOwnerId }),
      }),
    syncRatePolicyRepository:
      neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment(
        databaseEnvironment,
      ),
    syncHealthRepository: combinedServingRepository,
    historyCoverageRepository:
      neonDnaOpenLabP5FirstBackfillStatusReadRepositoryFromEnvironment(
        {
          ...databaseEnvironment,
          ...(configuredOwnerId === null ? {} : { ownerId: configuredOwnerId }),
        },
        DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
      ),
    rosterVersionRepository,
    substitutionSeasonYear: now.getUTCFullYear(),
    now,
  });

  return <ProLeagueCommissioningPanel state={commissioning} />;
}
