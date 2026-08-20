import {
  buildProLeaguePreparation,
  type ProLeaguePreparation,
  type ProLeaguePreparationCore,
} from "@/domain/pro-league-preparation";
import type { CorePerformanceProfileRepository } from "@/lib/core-intelligence-workspace-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

export type ProLeaguePreparationRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadByOwner: (ownerId: string) => Promise<
        Readonly<{
          cores: readonly ProLeaguePreparationCore[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type ProLeaguePreparationConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type ProLeaguePreparationPageState = Readonly<{
  connectionStatus: ProLeaguePreparationConnectionStatus;
  preparation: ProLeaguePreparation | null;
  lastImportedAt: string | null;
}>;

export const unavailableProLeaguePreparationRepository: ProLeaguePreparationRepository =
  Object.freeze({ status: "not_configured" });

export function createProLeaguePreparationRepository(input: {
  vaultRepository: OwnerVaultCatalogueRepository;
  performanceRepository: CorePerformanceProfileRepository;
}): ProLeaguePreparationRepository {
  if (
    input.vaultRepository.status !== "ready" ||
    input.performanceRepository.status !== "ready"
  ) {
    return unavailableProLeaguePreparationRepository;
  }
  const vault = input.vaultRepository;
  const performance = input.performanceRepository;
  return {
    status: "ready",
    async loadByOwner(ownerId) {
      const [cores, profiles] = await Promise.all([
        vault.listCoresByOwner(ownerId, {
          scope: "vault",
          query: null,
          element: null,
          coreClass: null,
          sex: null,
          fNumber: null,
        }),
        performance.listProfilesByOwner(ownerId),
      ]);
      const bikeByCore = new Map<
        string,
        ProLeaguePreparationCore["bikeProfiles"]
      >();
      for (const profile of profiles.profiles) {
        if (profile.mode !== "bike") continue;
        bikeByCore.set(profile.coreId, [
          ...(bikeByCore.get(profile.coreId) ?? []),
          {
            distanceMetres: profile.distance,
            raceCount: profile.raceCount,
            sampleStatus: profile.sampleStatus,
            freshness: profile.freshness,
            dataCurrentThrough: profile.dataCurrentThrough,
          },
        ]);
      }
      return {
        cores: cores
          .filter(({ inMyVault }) => inMyVault)
          .map((core) => ({
            coreId: core.sourceCoreId,
            displayName: core.displayName,
            coreClass: core.coreClass,
            element: core.element,
            sex: core.sex,
            fNumber: core.fNumber,
            bikeProfiles: bikeByCore.get(core.sourceCoreId) ?? [],
          })),
        lastImportedAt: profiles.lastImportedAt,
      };
    },
  };
}

function identity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function timestamp(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Pro League import timestamp is invalid.");
  }
  return value;
}

export async function loadProLeaguePreparationPageState(input: {
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: ProLeaguePreparationRepository;
}): Promise<ProLeaguePreparationPageState> {
  const authenticatedOwnerId = identity(input.authenticatedOwnerId);
  const configuredOwnerId = identity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      connectionStatus: "identity_not_connected",
      preparation: null,
      lastImportedAt: null,
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Pro League preparation access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      connectionStatus: "persistence_not_configured",
      preparation: null,
      lastImportedAt: null,
    };
  }
  const evidence = await input.repository.loadByOwner(authenticatedOwnerId);
  return {
    connectionStatus: "read_model_connected",
    preparation: buildProLeaguePreparation(evidence.cores),
    lastImportedAt: timestamp(evidence.lastImportedAt),
  };
}
