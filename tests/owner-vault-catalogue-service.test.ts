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

const publication = {
  coreDatasetVersionId: "11111111-1111-4111-8111-111111111111",
  importBatchId: "22222222-2222-4222-8222-222222222222",
  sourceSha256: "a".repeat(64),
  sourceRowCount: 8,
  acceptedRowCount: 7,
  coreCount: 7,
  evidenceRowCount: 8,
  activatedAt: "2026-08-11T00:30:00.000Z",
  dataCurrentThrough: null,
  aggregateRefreshedAt: "2026-08-11T00:45:00.000Z",
  evidenceSealedAt: "2026-08-11T00:50:00.000Z",
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

  it("binds the page rows to one accepted Core Details publication", async () => {
    const readCataloguePageByOwner = vi.fn(async () => ({
      cores: [core],
      publication,
    }));
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner: vi.fn(),
      readCataloguePageByOwner,
    };
    const state = await loadOwnerVaultCataloguePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      filters: { scope: "vault" },
    });

    expect(state).toMatchObject({
      connectionStatus: "connected",
      cores: [core],
      publication,
    });
    expect(readCataloguePageByOwner).toHaveBeenCalledWith(
      ownerId,
      state.filters,
    );
    expect(repository.listCoresByOwner).not.toHaveBeenCalled();
  });

  it("withholds catalogue rows when publication counts drift", async () => {
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner: vi.fn(),
      readCataloguePageByOwner: async () => ({
        cores: [core],
        publication: { ...publication, coreCount: 6 },
      }),
    };
    await expect(
      loadOwnerVaultCataloguePageState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        repository,
        filters: { scope: "vault" },
      }),
    ).resolves.toMatchObject({
      connectionStatus: "integrity_failed",
      cores: [],
    });
  });

  it("withholds all rows when the owner-scoped repository read fails", async () => {
    const repository: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner: async () => {
        throw new Error("Synthetic provider detail");
      },
    };
    const state = await loadOwnerVaultCataloguePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
      filters: { scope: "vault" },
    });

    expect(state).toMatchObject({
      connectionStatus: "read_failed",
      cores: [],
    });
    expect(JSON.stringify(state)).not.toContain("provider detail");
  });

  it("accepts owner API ownership while keeping registry-only fields unknown", async () => {
    const apiCore = {
      ...core,
      meEligible: null,
      version: null,
      source: "accepted_owner_api_snapshot" as const,
    };
    const state = await loadOwnerVaultCataloguePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: {
        status: "ready",
        listCoresByOwner: vi.fn(),
        readCataloguePageByOwner: async () => ({
          cores: [apiCore],
          publication: null,
          coverage: "accepted_owner_api_snapshot",
          apiSnapshot: {
            generationId: "33333333-3333-4333-8333-333333333333",
            coreCount: 214,
            oldestObservedAt: "2026-09-22T00:00:00.000Z",
            newestObservedAt: "2026-09-22T00:00:00.000Z",
          },
        }),
      },
      filters: { scope: "vault" },
    });

    expect(state).toMatchObject({
      connectionStatus: "connected",
      coverage: "accepted_owner_api_snapshot",
      cores: [{ meEligible: null, version: null }],
      apiSnapshot: { coreCount: 214 },
    });
  });

  it("withholds duplicate, impossible and inactive My Vault rows", async () => {
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
      ).resolves.toMatchObject({
        connectionStatus: "integrity_failed",
        cores: [],
      });
    }
  });
});
