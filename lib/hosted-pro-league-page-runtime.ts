import { DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET } from "@/lib/dna-open-lab-p5-first-backfill-approval";
import { loadProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";
import { neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-publication";
import { neonDnaOpenLabP5FirstBackfillStatusReadRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-p5-first-backfill-ledger";
import { neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment } from "@/lib/neon-dna-open-lab-sync-rate-policy-repository";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import { neonProLeagueBreedingRankingReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-breeding-ranking-repository";
import { neonProLeagueEvidenceReadRepositoryFromEnvironment } from "@/lib/neon-pro-league-evidence-generation-repository";
import { createNeonProLeagueRosterVersionRepository } from "@/lib/neon-pro-league-roster-version-repository";
import { createNeonProLeagueSubstitutionLedgerReadRepository } from "@/lib/neon-pro-league-substitution-ledger-read-repository";
import {
  loadProLeaguePlanPersistenceState,
  type ProLeaguePlanPersistenceState,
} from "@/lib/pro-league-plan-persistence-service";
import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

export type HostedProLeagueEnvironment = Readonly<{
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
  configuredOwnerId: string | null;
}>;

function persistenceConfiguration(environment: HostedProLeagueEnvironment) {
  const databaseUrl = environment.databaseUrl?.trim() ?? "";
  const databaseOwnerId = environment.databaseOwnerId?.trim() ?? "";
  const ownerId = environment.configuredOwnerId?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() || "dna_app_runtime";
  return databaseUrl === "" || databaseOwnerId === "" || ownerId === ""
    ? null
    : { databaseUrl, databaseOwnerId, ownerId, runtimeRole };
}

export function createHostedProLeagueRosterWriteRepository(
  environment: HostedProLeagueEnvironment,
) {
  const configuration = persistenceConfiguration(environment);
  if (configuration === null) {
    throw new Error("Pro League roster persistence is not configured.");
  }
  return createNeonProLeagueRosterVersionRepository(configuration);
}

export async function loadHostedProLeagueCommissioningState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    environment: HostedProLeagueEnvironment;
    now: Date;
  }>,
): Promise<ProLeagueDraftCommissioningState> {
  const databaseEnvironment = {
    ...(input.environment.databaseUrl === undefined
      ? {}
      : { databaseUrl: input.environment.databaseUrl }),
    ...(input.environment.databaseOwnerId === undefined
      ? {}
      : { databaseOwnerId: input.environment.databaseOwnerId }),
    ...(input.environment.runtimeRole === undefined
      ? {}
      : { runtimeRole: input.environment.runtimeRole }),
  };
  const databaseEnvironmentWithUndefined = {
    databaseUrl: input.environment.databaseUrl,
    databaseOwnerId: input.environment.databaseOwnerId,
    runtimeRole: input.environment.runtimeRole,
  };
  const combinedServingRepository =
    neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment({
      ...databaseEnvironment,
      validatedAt: input.now.toISOString(),
    });
  const evidenceRepository = neonProLeagueEvidenceReadRepositoryFromEnvironment(
    {
      ...databaseEnvironment,
      ...(input.environment.configuredOwnerId === null
        ? {}
        : { ownerId: input.environment.configuredOwnerId }),
    },
  );
  const persistence = persistenceConfiguration(input.environment);
  const rosterVersionRepository =
    persistence === null
      ? null
      : createNeonProLeagueSubstitutionLedgerReadRepository({
          databaseUrl: persistence.databaseUrl,
          databaseOwnerId: persistence.databaseOwnerId,
          ownerId: persistence.ownerId,
          runtimeRole: persistence.runtimeRole,
        });

  return loadProLeagueDraftCommissioningState({
    authenticatedOwnerId: input.authenticatedOwnerId,
    configuredOwnerId: input.environment.configuredOwnerId,
    vaultId: "my-vault",
    vaultDisplayName: "My Vault",
    rosteredCoreIds: [],
    useOwnerFinalPlan: true,
    vaultRepository: neonOwnerVaultCatalogueRepositoryFromEnvironment(
      databaseEnvironmentWithUndefined,
    ),
    evidenceRepository,
    ownedCoreRepository: combinedServingRepository,
    currentStateRepository: combinedServingRepository,
    currentRaceRepository: combinedServingRepository,
    breedingRepository:
      neonProLeagueBreedingRankingReadRepositoryFromEnvironment({
        ...databaseEnvironment,
        ...(input.environment.configuredOwnerId === null
          ? {}
          : { ownerId: input.environment.configuredOwnerId }),
      }),
    syncRatePolicyRepository:
      neonDnaOpenLabSyncRatePolicyRepositoryFromEnvironment(
        databaseEnvironmentWithUndefined,
      ),
    syncHealthRepository: combinedServingRepository,
    historyCoverageRepository:
      neonDnaOpenLabP5FirstBackfillStatusReadRepositoryFromEnvironment(
        {
          ...databaseEnvironment,
          ...(input.environment.configuredOwnerId === null
            ? {}
            : { ownerId: input.environment.configuredOwnerId }),
        },
        DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
      ),
    rosterVersionRepository,
    substitutionSeasonYear: input.now.getUTCFullYear(),
    now: input.now,
  });
}

export async function loadHostedProLeaguePlanPersistenceState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    environment: HostedProLeagueEnvironment;
    commissioning: ProLeagueDraftCommissioningState;
  }>,
): Promise<ProLeaguePlanPersistenceState> {
  const configuration = persistenceConfiguration(input.environment);
  const repository =
    configuration === null
      ? null
      : createNeonProLeagueRosterVersionRepository(configuration);
  return loadProLeaguePlanPersistenceState({
    authenticatedOwnerId: input.authenticatedOwnerId,
    configuredOwnerId: input.environment.configuredOwnerId,
    commissioning: input.commissioning,
    rosterRepository: repository,
  });
}
