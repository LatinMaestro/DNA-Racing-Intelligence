import { describe, expect, it, vi } from "vitest";

import {
  loadSearchCorePageState,
  type SearchCorePageState,
} from "../lib/search-core-service";
import type { OwnerVaultCatalogueRepository } from "../lib/owner-vault-catalogue-service";

const ownerId = "user_owner";
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

describe("Search Core service", () => {
  it("does not query or expose catalogue rows before a search", async () => {
    const listCoresByOwner = vi.fn(async () => [core]);
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner,
    };
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
    });
    expect(state).toMatchObject({
      connectionStatus: "connected",
      query: null,
      results: [],
      selectedCore: null,
      performanceStatus: "not_connected",
    } satisfies Partial<SearchCorePageState>);
    expect(listCoresByOwner).not.toHaveBeenCalled();
  });

  it("searches the game-wide Core Details catalogue rather than My Vault only", async () => {
    const listCoresByOwner = vi.fn(async () => [core]);
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner,
    };
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      query: "Seven",
    });
    expect(state.results).toEqual([core]);
    expect(listCoresByOwner).toHaveBeenLastCalledWith(
      ownerId,
      expect.objectContaining({ scope: "catalogue", query: "Seven" }),
    );
  });

  it("selects only an exact durable Core ID from the returned catalogue", async () => {
    const other = { ...core, sourceCoreId: "core-70", displayName: "Seventy" };
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner: async () => [core, other],
    };
    const state = await loadSearchCorePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
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
        query: "Seven",
      }),
    ).resolves.toMatchObject({ connectionStatus: "identity_not_connected" });

    await expect(
      loadSearchCorePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository: { status: "not_configured" },
        query: "Seven",
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
    });
  });
});
