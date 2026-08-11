import { describe, expect, it, vi } from "vitest";

import type { CorePerformanceProfile } from "../domain/core-performance";
import type { CorePerformanceProfileRepository } from "../lib/core-intelligence-workspace-service";
import type { OwnerVaultCatalogueRepository } from "../lib/owner-vault-catalogue-service";
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
});
