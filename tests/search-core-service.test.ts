import { describe, expect, it, vi } from "vitest";

import type { CorePerformanceProfile } from "../domain/core-performance";
import type { CorePerformanceProfileRepository } from "../lib/core-intelligence-workspace-service";
import type { OwnerVaultCatalogueRepository } from "../lib/owner-vault-catalogue-service";
import type { RaceArchiveCoreHistoryService } from "../lib/race-archive-core-history-service";
import type { ActiveSelectedDnaCoreRaceHistoryReadRepository } from "../lib/neon-active-dna-core-race-history-generation";
import type { PopulationCoreIdentityRepository } from "../lib/neon-population-core-identity-repository";
import {
  loadSearchCorePageState,
  type SearchCorePageState,
} from "../lib/search-core-service";

const ownerId = "user_owner";
const now = new Date("2026-08-11T03:00:00.000Z");
const core = {
  sourceCoreId: "core-7",
  displayName: "Seven",
  coreClass: "Genesis" as const,
  element: "Fire" as const,
  fNumber: 2,
  sex: "female" as const,
  inMyVault: false,
  meEligible: false,
  version: 0,
  updatedAt: null,
};

const profile: CorePerformanceProfile = {
  coreId: "core-7",
  mode: "bike",
  distance: 1050,
  dataCurrentThrough: "2026-08-11T01:00:00.000Z",
  freshness: "current",
  raceCount: 2,
  sampleStatus: "hypothesis_only",
  elapsedTime: {
    bestMilliseconds: 50000,
    medianMilliseconds: 51250,
    meanMilliseconds: 51250,
    trimmedMeanMilliseconds: 51250,
    standardDeviationMilliseconds: 1250,
    interquartileRangeMilliseconds: 1250,
  },
  speed: {
    bestMetresPerSecond: 21,
    medianMetresPerSecond: 20.488,
  },
  starProfile: null,
  analyticalStatus: "experimental",
};

const noPerformance: CorePerformanceProfileRepository = {
  status: "not_configured",
};

type ReadyCatalogue = Extract<
  OwnerVaultCatalogueRepository,
  Readonly<{ status: "ready" }>
>;

function catalogue(
  listCoresByOwner: ReadyCatalogue["listCoresByOwner"],
): OwnerVaultCatalogueRepository {
  return { status: "ready", listCoresByOwner };
}

describe("Search Core service", () => {
  it("falls back to an exact accepted population identity without fabricating profile metadata", async () => {
    const readExactIdentity = vi.fn(async () => ({
      sourceCoreId: "9002",
      generationId: "22222222-2222-4222-8222-222222222222",
      evaluatedAt: "2026-10-06T05:02:00.000Z",
      coreSetSha256: "a".repeat(64),
      populationCoreCount: 4_096,
    }));
    const populationIdentityRepository: PopulationCoreIdentityRepository = {
      status: "ready",
      readExactIdentity,
    };
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => []),
      performanceRepository: noPerformance,
      populationIdentityRepository,
      now,
      query: "9002",
    });
    expect(readExactIdentity).toHaveBeenCalledWith(ownerId, "9002");
    expect(state).toMatchObject({
      results: [],
      selectedCore: null,
      populationIdentityStatus: "connected",
      populationIdentity: {
        sourceCoreId: "9002",
        populationCoreCount: 4_096,
      },
    });
  });

  it("does not query or expose catalogue rows before a search", async () => {
    const listCoresByOwner = vi.fn(async () => [core]);
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(listCoresByOwner),
      performanceRepository: noPerformance,
      now,
    });
    expect(state).toMatchObject({
      connectionStatus: "connected",
      query: null,
      results: [],
      selectedCore: null,
      performanceStatus: "not_connected",
      performanceProfiles: [],
      archiveHistoryStatus: "not_connected",
    } satisfies Partial<SearchCorePageState>);
    expect(listCoresByOwner).not.toHaveBeenCalled();
  });

  it("searches the game-wide Core Details catalogue rather than My Vault only", async () => {
    const listCoresByOwner = vi.fn(async () => [core]);
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(listCoresByOwner),
      performanceRepository: noPerformance,
      now,
      query: "Seven",
    });
    expect(state.results).toEqual([core]);
    expect(listCoresByOwner).toHaveBeenLastCalledWith(
      ownerId,
      expect.objectContaining({ scope: "catalogue", query: "Seven" }),
    );
  });

  it("loads only the selected core's compact historical performance", async () => {
    const listProfilesByOwner = vi.fn(async () => ({
      profiles: [profile],
      lastImportedAt: "2026-08-11T02:00:00.000Z",
    }));
    const performanceRepository: CorePerformanceProfileRepository = {
      status: "ready",
      listProfilesByOwner,
    };
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => [core]),
      performanceRepository,
      now,
      query: "Seven",
      selectedCoreId: "core-7",
    });
    expect(state.selectedCore).toEqual(core);
    expect(state.performanceStatus).toBe("connected");
    expect(state.performanceProfiles).toEqual([profile]);
    expect(state.performanceLastImportedAt).toBe("2026-08-11T02:00:00.000Z");
    expect(listProfilesByOwner).toHaveBeenCalledWith(ownerId, "core-7");
  });

  it("loads generation-pinned accepted history only for the selected Core", async () => {
    const readActiveGeneration = vi.fn(async () => ({
      generationId: "a".repeat(64),
      observationSetSha256: "b".repeat(64),
      publishedAt: "2026-08-11T02:30:00.000Z",
      observationCount: 93_089,
    }));
    const row = {
      generationId: "a".repeat(64),
      ordinal: 7,
      naturalKey: "core-result:core-7:bike:race-9",
      rowSha256: "c".repeat(64),
      payload: {
        sourceType: "joined_core_race_history_result",
        naturalKey: "core-result:core-7:bike:race-9",
        resultEvidenceSha256: "d".repeat(64),
        raceDocumentEvidenceSha256: "e".repeat(64),
        raceDocumentObservedAt: "2026-08-11T01:30:00.000Z",
        sourceCoreId: "core-7",
        sourceRaceId: "race-9",
        mode: "bike",
        distanceMetres: 2_300,
        distanceAuthority: "result_and_race_document",
        elapsedMilliseconds: 137_810,
        finishPosition: 4,
        eventAt: "2026-08-11T01:00:00.000Z",
        gateCount: 6,
        payoutMechanismSourceValue: null,
        sourceFormat: "normal",
        sourceRaceClass: null,
        goldStar: null,
        blueStar: null,
        starEvidenceStatus: "missing",
        publishedCellStatus: "unsupported_format",
        raceType: null,
        mapIds: [],
      },
    } as const;
    const acceptedRow = {
      ...row,
      ordinal: 8,
      naturalKey: "core-result:core-7:bike:race-10",
      rowSha256: "f".repeat(64),
      payload: {
        ...row.payload,
        naturalKey: "core-result:core-7:bike:race-10",
        sourceRaceId: "race-10",
        eventAt: "2026-08-11T01:10:00.000Z",
        elapsedMilliseconds: 136_000,
        publishedCellStatus: "accepted" as const,
      },
    } as const;
    const readSelectedCoreRows = vi.fn(async () => ({
      status: "ready" as const,
      rows: [row, acceptedRow],
    }));
    const acceptedHistoryRepository = {
      readActiveGeneration,
      readSelectedCoreRows,
      readActiveRows: vi.fn(),
    } as unknown as ActiveSelectedDnaCoreRaceHistoryReadRepository;

    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => [core]),
      performanceRepository: noPerformance,
      acceptedHistoryRepository,
      now,
      query: "Seven",
      selectedCoreId: "core-7",
    });

    expect(readActiveGeneration).toHaveBeenCalledWith(ownerId);
    expect(readSelectedCoreRows).toHaveBeenCalledWith(ownerId, {
      generationId: "a".repeat(64),
      observationSetSha256: "b".repeat(64),
      coreIds: ["core-7"],
      maximumRows: 1_000,
    });
    expect(state.acceptedHistoryStatus).toBe("connected");
    expect(state.acceptedHistoryRows).toEqual([row, acceptedRow]);
    expect(state.performanceAuthority).toBe("accepted_history_generation");
    expect(state.performanceProfiles).toHaveLength(1);
    expect(state.performanceProfiles[0]).toMatchObject({
      coreId: "core-7",
      mode: "bike",
      distance: 2_300,
      raceCount: 1,
      elapsedTime: { bestMilliseconds: 136_000 },
      starProfile: null,
    });
    expect(state.performanceLastImportedAt).toBe("2026-08-11T02:30:00.000Z");
  });

  it("loads bounded immutable archive evidence only for the selected Core", async () => {
    const load = vi.fn(async () => ({
      sourceCoreId: "core-7",
      locatorVersionCount: 2,
      selectedPartitionCount: 3,
      rows: [
        {
          datasetVersionId: "11111111-1111-4111-8111-111111111111",
          importBatchId: "22222222-2222-4222-8222-222222222222",
          versionNumber: 1,
          partitionNumber: 2,
          sourceRowNumber: 4,
          naturalKey: "event-1:core-7",
          fingerprintSha256: "a".repeat(64),
          row: Object.freeze({}) as never,
        },
        {
          datasetVersionId: "33333333-3333-4333-8333-333333333333",
          importBatchId: "44444444-4444-4444-8444-444444444444",
          versionNumber: 2,
          partitionNumber: 7,
          sourceRowNumber: 9,
          naturalKey: "event-2:core-7",
          fingerprintSha256: "b".repeat(64),
          row: Object.freeze({}) as never,
        },
      ],
    }));
    const archiveHistoryService: RaceArchiveCoreHistoryService = { load };

    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => [core]),
      performanceRepository: noPerformance,
      archiveHistoryService,
      now,
      query: "Seven",
      selectedCoreId: "core-7",
    });

    expect(load).toHaveBeenCalledWith({ ownerId, sourceCoreId: "core-7" });
    expect(state).toMatchObject({
      archiveHistoryStatus: "connected",
      archiveHistoryVersionCount: 2,
      archiveHistoryPartitionCount: 3,
      archiveHistoryRowCount: 2,
    });
  });

  it("distinguishes absent sealed archive locators from an unconfigured archive runtime", async () => {
    const missingArchive: RaceArchiveCoreHistoryService = {
      load: vi.fn(async () => ({
        sourceCoreId: "core-7",
        locatorVersionCount: 0,
        selectedPartitionCount: 0,
        rows: [],
      })),
    };
    const common = {
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => [core]),
      performanceRepository: noPerformance,
      now,
      query: "Seven",
      selectedCoreId: "core-7",
    } as const;

    await expect(
      loadSearchCorePageState({
        ...common,
        archiveHistoryService: missingArchive,
      }),
    ).resolves.toMatchObject({ archiveHistoryStatus: "missing" });
    await expect(loadSearchCorePageState(common)).resolves.toMatchObject({
      archiveHistoryStatus: "not_connected",
    });
  });

  it("preserves accepted catalogue and performance when optional archive verification fails", async () => {
    const load = vi.fn(async () => {
      throw new Error("Synthetic sealed archive verification failed");
    });
    const listProfilesByOwner = vi.fn(async () => ({
      profiles: [profile],
      lastImportedAt: "2026-08-11T02:00:00.000Z",
    }));
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => [core]),
      performanceRepository: { status: "ready", listProfilesByOwner },
      archiveHistoryService: { load },
      now,
      query: "Seven",
      selectedCoreId: "core-7",
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ ownerId, sourceCoreId: "core-7" });
    expect(state.selectedCore).toEqual(core);
    expect(state.results).toEqual([core]);
    expect(state.performanceStatus).toBe("connected");
    expect(state.performanceProfiles).toEqual([profile]);
    expect(state.performanceLastImportedAt).toBe("2026-08-11T02:00:00.000Z");
    expect(state).toMatchObject({
      archiveHistoryStatus: "unavailable",
      archiveHistoryVersionCount: 0,
      archiveHistoryPartitionCount: 0,
      archiveHistoryRowCount: 0,
    });
    expect(JSON.stringify(state)).not.toContain("verification failed");
  });

  it("does not retrieve archive rows for unauthorised or unresolved Core selections", async () => {
    const load = vi.fn(async () => {
      throw new Error("Archive must not be reached");
    });
    const common = {
      repository: catalogue(async () => [core]),
      performanceRepository: noPerformance,
      archiveHistoryService: { load },
      now,
      query: "Seven",
    } as const;

    await expect(
      loadSearchCorePageState({
        ...common,
        authenticatedOwnerId: null,
        configuredOwnerId: ownerId,
        selectedCoreId: "core-7",
      }),
    ).resolves.toMatchObject({
      connectionStatus: "identity_not_connected",
      archiveHistoryStatus: "not_connected",
    });
    await expect(
      loadSearchCorePageState({
        ...common,
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        selectedCoreId: "unmatched-core",
      }),
    ).resolves.toMatchObject({
      selectedCore: null,
      archiveHistoryStatus: "not_connected",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("selects only an exact durable Core ID from the returned catalogue", async () => {
    const other = { ...core, sourceCoreId: "core-70", displayName: "Seventy" };
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: catalogue(async () => [core, other]),
      performanceRepository: noPerformance,
      now,
      query: "Seven",
      selectedCoreId: "core-7",
    });
    expect(state.selectedCore).toEqual(core);
  });

  it("preserves fail-closed identity and persistence states", async () => {
    await expect(
      loadSearchCorePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: ownerId,
        repository: { status: "not_configured" },
        performanceRepository: noPerformance,
        now,
        query: "Seven",
      }),
    ).resolves.toMatchObject({ connectionStatus: "identity_not_connected" });

    await expect(
      loadSearchCorePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: { status: "not_configured" },
        performanceRepository: noPerformance,
        now,
        query: "Seven",
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
    });
  });

  it("withholds Search Core evidence after catalogue read or integrity failure", async () => {
    const failedRead = vi.fn(async () => {
      throw new Error("Synthetic provider detail");
    });
    await expect(
      loadSearchCorePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: catalogue(failedRead),
        performanceRepository: noPerformance,
        now,
        query: "Seven",
        selectedCoreId: "core-7",
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_failed",
      results: [],
      selectedCore: null,
      performanceProfiles: [],
      archiveHistoryStatus: "not_connected",
    });
    expect(failedRead).toHaveBeenCalledTimes(1);

    await expect(
      loadSearchCorePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: catalogue(async () => [core, core]),
        performanceRepository: noPerformance,
        now,
        query: "Seven",
        selectedCoreId: "core-7",
      }),
    ).resolves.toMatchObject({
      connectionStatus: "integrity_failed",
      results: [],
      selectedCore: null,
      performanceProfiles: [],
      archiveHistoryStatus: "not_connected",
    });
  });
});
