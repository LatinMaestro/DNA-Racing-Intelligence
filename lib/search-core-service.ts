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

const SAFE_OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function ownerId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (!SAFE_OWNER_ID.test(normalized)) {
    throw new Error("Search Core owner identity is invalid.");
  }
  return normalized;
}

function searchQuery(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    throw new Error("Search Core query is invalid.");
  const normalized = value.trim();
  if (normalized === "") return null;
  if (normalized.length > 128)
    throw new Error("Search Core query is too long.");
  return normalized;
}

function selectedCoreId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    throw new Error("Selected Core ID is invalid.");
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 256) {
    throw new Error("Selected Core ID is invalid.");
  }
  return normalized;
}

function connectionStatus(input: Readonly<{
  authenticatedOwnerId: string | null;
  configuredOwnerId: string | null;
  repository: OwnerVaultCatalogueRepository;
}>): SearchCorePageState["connectionStatus"] {
  const authenticatedOwnerId = ownerId(input.authenticatedOwnerId);
  const configuredOwnerId = ownerId(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return "identity_not_connected";
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Search Core access denied.");
  }
  return input.repository.status === "ready"
    ? "connected"
    : "persistence_not_configured";
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
  const status = connectionStatus(input);

  if (query === null && selectedId === null) {
    return {
      connectionStatus: status,
      query,
      results: [],
      selectedCore: null,
      performanceStatus: "not_connected",
    };
  }
  if (status !== "connected") {
    return {
      connectionStatus: status,
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
    if (selectedCore === null) {
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
