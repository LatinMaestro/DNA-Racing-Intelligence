import {
  neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment,
  type DnaOpenLabCombinedServingReadRepository,
} from "@/lib/neon-dna-open-lab-sync-publication";
import { neonOwnerVaultCatalogueRepositoryFromEnvironment } from "@/lib/neon-owner-vault-catalogue-repository";
import type {
  OwnerVaultCatalogueCore,
  OwnerVaultCatalogueFilters,
  OwnerVaultCatalogueRead,
  OwnerVaultCatalogueRepository,
} from "@/lib/owner-vault-catalogue-service";
import {
  OWNER_CORE_CATALOGUE_LIST_LIMIT,
  OWNER_VAULT_LIST_LIMIT,
} from "@/lib/owner-vault-catalogue-service";

function matches(
  core: OwnerVaultCatalogueCore,
  filters: OwnerVaultCatalogueFilters,
) {
  const query = filters.query?.toLocaleLowerCase("en-AU") ?? null;
  return (
    (query === null ||
      core.sourceCoreId.toLocaleLowerCase("en-AU") === query ||
      core.displayName.toLocaleLowerCase("en-AU").includes(query)) &&
    (filters.element === null || core.element === filters.element) &&
    (filters.coreClass === null || core.coreClass === filters.coreClass) &&
    (filters.sex === null || core.sex === filters.sex) &&
    (filters.fNumber === null || core.fNumber === filters.fNumber)
  );
}

export function createOwnerVaultApiCatalogueRepository(
  input: Readonly<{
    fallback: OwnerVaultCatalogueRepository;
    apiRepository: Pick<
      DnaOpenLabCombinedServingReadRepository,
      "readServingOwnedCores"
    >;
  }>,
): OwnerVaultCatalogueRepository {
  async function readCataloguePageByOwner(
    ownerId: string,
    filters: OwnerVaultCatalogueFilters,
  ): Promise<OwnerVaultCatalogueRead> {
    if (input.fallback.status === "ready") {
      try {
        if (input.fallback.readCataloguePageByOwner) {
          const read = await input.fallback.readCataloguePageByOwner(
            ownerId,
            filters,
          );
          if (read.publication !== null) return read;
        }
        const cores = await input.fallback.listCoresByOwner(ownerId, filters);
        if (cores.length > 0) {
          return { cores, publication: null };
        }
      } catch {
        // The accepted Core Details projection may be absent while the
        // independently accepted owner API snapshot remains usable.
      }
    }

    const serving = await input.apiRepository.readServingOwnedCores({
      ownerId,
    });
    if (serving.length === 0) {
      throw new Error("Accepted owner API Core snapshot is unavailable.");
    }
    const generationIds = new Set(
      serving.map(({ generationId }) => generationId),
    );
    if (generationIds.size !== 1) {
      throw new Error("Accepted owner API Core generation is inconsistent.");
    }
    const observed = serving.map(({ observedAt }) => Date.parse(observedAt));
    if (observed.some(Number.isNaN)) {
      throw new Error("Accepted owner API Core observation time is invalid.");
    }
    const cores = serving
      .map(({ canonical, observedAt }): OwnerVaultCatalogueCore => ({
        sourceCoreId: canonical.sourceCoreId,
        displayName: canonical.displayName,
        coreClass: canonical.coreClass,
        element: canonical.element,
        fNumber: canonical.fNumber,
        sex: canonical.sex,
        inMyVault: true,
        meEligible: null,
        version: null,
        updatedAt: observedAt,
        source: "accepted_owner_api_snapshot",
      }))
      .filter((core) => matches(core, filters))
      .slice(
        0,
        filters.scope === "vault"
          ? OWNER_VAULT_LIST_LIMIT
          : OWNER_CORE_CATALOGUE_LIST_LIMIT,
      );
    return {
      cores: Object.freeze(cores),
      publication: null,
      coverage: "accepted_owner_api_snapshot",
      apiSnapshot: {
        generationId: [...generationIds][0]!,
        coreCount: serving.length,
        oldestObservedAt: new Date(Math.min(...observed)).toISOString(),
        newestObservedAt: new Date(Math.max(...observed)).toISOString(),
      },
    };
  }

  return {
    status: "ready",
    async listCoresByOwner(ownerId, filters) {
      return (await readCataloguePageByOwner(ownerId, filters)).cores;
    },
    readCataloguePageByOwner,
  };
}

export function ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment(
  environment: Readonly<{
    databaseUrl: string | undefined;
    databaseOwnerId: string | undefined;
    runtimeRole: string | undefined;
  }>,
  validatedAt: string,
): OwnerVaultCatalogueRepository {
  const fallback =
    neonOwnerVaultCatalogueRepositoryFromEnvironment(environment);
  const apiRepository =
    neonDnaOpenLabCombinedServingReadRepositoryFromEnvironment({
      ...(environment.databaseUrl === undefined
        ? {}
        : { databaseUrl: environment.databaseUrl }),
      ...(environment.databaseOwnerId === undefined
        ? {}
        : { databaseOwnerId: environment.databaseOwnerId }),
      ...(environment.runtimeRole === undefined
        ? {}
        : { runtimeRole: environment.runtimeRole }),
      validatedAt,
    });
  return apiRepository === null
    ? fallback
    : createOwnerVaultApiCatalogueRepository({ fallback, apiRepository });
}
