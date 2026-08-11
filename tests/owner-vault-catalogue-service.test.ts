import { describe, expect, it, vi } from "vitest";

import {
  loadOwnerVaultCataloguePageState,
  normalizeOwnerVaultCatalogueFilters,
  type OwnerVaultCatalogueRepository,
} from "../lib/owner-vault-catalogue-service";

const ownerId = "user_owner";
const core = {
  sourceCoreId: "core-7",
  displayName: "Seven",
  coreClass: "Genesis" as const,
  element: "Fire" as const,
  fNumber: 2,
  sex: "female" as const,
  inMyVault: true,
  meEligible: true,
  version: 4,
  updatedAt: "2026-08-11T01:00:00.000Z",
};

describe("owner Vault catalogue service", () => {
  it("normalizes the supported Vault filters", () => {
    expect(
      normalizeOwnerVaultCatalogueFilters({
        scope: "catalogue",
        query: "  seven  ",
        element: "Fire",
        coreClass: "Genesis",
        sex: "female",
        fNumber: "2",
      }),
    ).toEqual({
      scope: "catalogue",
      query: "seven",
      element: "Fire",
      coreClass: "Genesis",
      sex: "female",
      fNumber: 2,
    });
    expect(() =>
      normalizeOwnerVaultCatalogueFilters({ element: "Air" }),
    ).toThrow("Vault element filter is invalid.");
  });

  it("does not query persistence until the owner identity is connected", async () => {
    const listCoresByOwner = vi.fn();
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner,
    };
    await expect(
      loadOwnerVaultCataloguePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: ownerId,
        repository,
        filters: { scope: "vault" },
      }),
    ).resolves.toEqual({
      connectionStatus: "identity_not_connected",
      filters: {
        scope: "vault",
        query: null,
        element: null,
        coreClass: null,
        sex: null,
        fNumber: null,
      },
      cores: [],
    });
    expect(listCoresByOwner).not.toHaveBeenCalled();
  });

  it("loads owner-maintained Vault cores with normalized filters", async () => {
    const listCoresByOwner = vi.fn(async () => [core]);
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner,
    };
    const state = await loadOwnerVaultCataloguePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      filters: { scope: "vault", query: "Seven", element: "Fire" },
    });
    expect(state.connectionStatus).toBe("connected");
    expect(state.cores).toEqual([core]);
    expect(listCoresByOwner).toHaveBeenCalledWith(ownerId, state.filters);
  });

  it("rejects duplicate, impossible and inactive My Vault rows", async () => {
    for (const rows of [
      [core, core],
      [{ ...core, inMyVault: false, meEligible: false }],
      [{ ...core, inMyVault: false, meEligible: true }],
    ]) {
      const repository: OwnerVaultCatalogueRepository = {
        status: "ready",
        listCoresByOwner: async () => rows,
      };
      await expect(
        loadOwnerVaultCataloguePageState({
          authenticatedOwnerId: ownerId,
          configuredOwnerId: ownerId,
          repository,
          filters: { scope: "vault" },
        }),
      ).rejects.toThrow(/duplicate core|inactive core|invalid/);
    }
  });
});
