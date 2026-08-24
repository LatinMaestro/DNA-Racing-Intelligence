import type { CorePerformanceProfile } from "@/domain/core-performance";
import type { CorePerformanceProfileRepository } from "./core-intelligence-workspace-service";
import { loadCoreIntelligencePageState } from "./core-intelligence-workspace-service";
import type {
  OwnerVaultCatalogueCore,
  OwnerVaultCatalogueRepository,
} from "./owner-vault-catalogue-service";
import { loadOwnerVaultCataloguePageState } from "./owner-vault-catalogue-service";
import type { RaceArchiveCoreHistoryService } from "./race-archive-core-history-service";

export type SearchCorePageState = Readonly<{
  connectionStatus:
    "identity_not_connected" | "persistence_not_configured" | "connected";
  query: string | null;
  results: readonly OwnerVaultCatalogueCore[];
  selectedCore: OwnerVaultCatalogueCore | null;
  performanceStatus: "not_connected" | "connected";
  performanceProfiles: readonly CorePerformanceProfile[];
  performanceLastImportedAt: string | null;
  archiveHistoryStatus: "not_connected" | "missing" | "connected";
  archiveHistoryVersionCount: number;
  archiveHistoryPartitionCount: number;
  archiveHistoryRowCount: number;
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

function connectionStatus(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: OwnerVaultCatalogueRepository;
  }>,
): SearchCorePageState["connectionStatus"] {
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

const noPerformance = Object.freeze({
  performanceStatus: "not_connected" as const,
  performanceProfiles: [] as readonly CorePerformanceProfile[],
  performanceLastImportedAt: null,
});

const noArchiveHistory = Object.freeze({
  archiveHistoryStatus: "not_connected" as const,
  archiveHistoryVersionCount: 0,
  archiveHistoryPartitionCount: 0,
  archiveHistoryRowCount: 0,
});

async function archiveHistory(input: {
  service: RaceArchiveCoreHistoryService | null;
  ownerId: string | null;
  sourceCoreId: string;
}): Promise<
  Pick<
    SearchCorePageState,
    | "archiveHistoryStatus"
    | "archiveHistoryVersionCount"
    | "archiveHistoryPartitionCount"
    | "archiveHistoryRowCount"
  >
> {
  if (input.service === null || input.ownerId === null) return noArchiveHistory;
  const history = await input.service.load({
    ownerId: input.ownerId,
    sourceCoreId: input.sourceCoreId,
  });
  if (history.locatorVersionCount === 0) {
    return Object.freeze({
      archiveHistoryStatus: "missing" as const,
      archiveHistoryVersionCount: 0,
      archiveHistoryPartitionCount: 0,
      archiveHistoryRowCount: 0,
    });
  }
  return Object.freeze({
    archiveHistoryStatus: "connected" as const,
    archiveHistoryVersionCount: history.locatorVersionCount,
    archiveHistoryPartitionCount: history.selectedPartitionCount,
    archiveHistoryRowCount: history.rows.length,
  });
}

export async function loadSearchCorePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: OwnerVaultCatalogueRepository;
    performanceRepository: CorePerformanceProfileRepository;
    archiveHistoryService?: RaceArchiveCoreHistoryService | null;
    now: Date;
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
      ...noPerformance,
      ...noArchiveHistory,
    };
  }
  if (status !== "connected") {
    return {
      connectionStatus: status,
      query,
      results: [],
      selectedCore: null,
      ...noPerformance,
      ...noArchiveHistory,
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

  if (selectedCore === null) {
    return {
      connectionStatus: catalogue.connectionStatus,
      query,
      results: catalogue.cores,
      selectedCore,
      ...noPerformance,
      ...noArchiveHistory,
    };
  }

  const archived = await archiveHistory({
    service: input.archiveHistoryService ?? null,
    ownerId: input.authenticatedOwnerId,
    sourceCoreId: selectedCore.sourceCoreId,
  });

  if (input.performanceRepository.status !== "ready") {
    return {
      connectionStatus: catalogue.connectionStatus,
      query,
      results: catalogue.cores,
      selectedCore,
      ...noPerformance,
      ...archived,
    };
  }

  const scopedPerformanceRepository: CorePerformanceProfileRepository = {
    status: "ready",
    listProfilesByOwner: (authenticatedOwnerId) =>
      input.performanceRepository.status === "ready"
        ? input.performanceRepository.listProfilesByOwner(
            authenticatedOwnerId,
            selectedCore.sourceCoreId,
          )
        : Promise.reject(new Error("Search Core performance is unavailable.")),
  };
  const performance = await loadCoreIntelligencePageState({
    authenticatedOwnerId: input.authenticatedOwnerId,
    configuredOwnerId: input.configuredOwnerId,
    repository: scopedPerformanceRepository,
    now: input.now,
  });

  return {
    connectionStatus: catalogue.connectionStatus,
    query,
    results: catalogue.cores,
    selectedCore,
    performanceStatus:
      performance.connectionStatus === "read_model_connected"
        ? "connected"
        : "not_connected",
    performanceProfiles: performance.profiles.filter(
      (profile) => profile.coreId === selectedCore.sourceCoreId,
    ),
    performanceLastImportedAt: performance.lastImportedAt,
    ...archived,
  };
}
