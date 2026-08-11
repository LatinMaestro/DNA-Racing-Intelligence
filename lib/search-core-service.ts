import type {
  OwnerVaultCatalogueCore,
  OwnerVaultCatalogueRepository,
} from "./owner-vault-catalogue-service";
import { loadOwnerVaultCataloguePageState } from "./owner-vault-catalogue-service";

export type SearchCorePageState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "connected";
  query: string | null;
  results: readonly OwnerVaultCatalogueCore[];
  selectedCore: OwnerVaultCatalogueCore | null;
  performanceStatus: "not_connected";
}>;

function searchQuery(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Search Core query is invalid.");
  const normalized = value.trim();
  if (normalized === "") return null;
  if (normalized.length > 128) throw new Error("Search Core query is too long.");
  return normalized;
}

function selectedCoreId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Selected Core ID is invalid.");
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 256) {
    throw new Error("Selected Core ID is invalid.");
  }
  return normalized;
}

export async function loadSearchCorePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: OwnerVaultCatalogueRepository;
    query?: unknown;
    selectedCoreId?: unknown;
  }>,
): Promise<SearchCorePageState> {
  const query = searchQuery(input.query);
  const selectedId = selectedCoreId(input.selectedCoreId);

  if (query === null && selectedId === null) {
    const empty = await loadOwnerVaultCataloguePageState({
      authenticatedOwnerId: input.authenticatedOwnerId,
      configuredOwnerId: input.configuredOwnerId,
      repository: input.repository,
      filters: { scope: "catalogue", query: "__no_unprompted_catalogue_results__" },
    });
    return {
      connectionStatus: empty.connectionStatus,
      query,
      results: [],
      selectedCore: null,
      performanceStatus: "not_connected",
    };
  }

  const lookup = query ?? selectedId!;
  const catalogue = await loadOwnerVaultCataloguePageState({
    authenticatedOwnerId: input.authenticatedOwnerId,
    configuredOwnerId: input.configuredOwnerId,
    repository: input.repository,
    filters: { scope: "catalogue", query: lookup },
  });

  let selectedCore: OwnerVaultCatalogueCore | null = null;
  if (selectedId !== null) {
    selectedCore =
      catalogue.cores.find((core) => core.sourceCoreId === selectedId) ?? null;
    if (selectedCore === null && catalogue.connectionStatus === "connected") {
      const exact = await loadOwnerVaultCataloguePageState({
        authenticatedOwnerId: input.authenticatedOwnerId,
        configuredOwnerId: input.configuredOwnerId,
        repository: input.repository,
        filters: { scope: "catalogue", query: selectedId },
      });
      selectedCore =
        exact.cores.find((core) => core.sourceCoreId === selectedId) ?? null;
    }
  }

  return {
    connectionStatus: catalogue.connectionStatus,
    query,
    results: catalogue.cores,
    selectedCore,
    performanceStatus: "not_connected",
  };
}
